/**
 * The MDM Server stack has three main components:
 *  - API Gateway that proxies all requests
 *  - Lambda function that handles requests
 *  - EFS storage to host the files
 * 
 * It requires a VPC to be passed in so we can share VPCs across all stacks in this app. EFS Storage requires a VPC.
*/

import { Construct } from 'constructs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as path from "path";
import { LambdaRestApi } from 'aws-cdk-lib/aws-apigateway';

export interface MDMServerStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  apiPassword: string;
  certificatePath: string;
}

export class MDMServerStack extends cdk.Stack {

  // these variables are based on CDK's cross-stack resource sharing pattern
  // as outlined here https://www.endoflineblog.com/cdk-tips-03-how-to-unblock-cross-stack-references
  public readonly api: LambdaRestApi;

  constructor(scope: Construct, id: string, props: MDMServerStackProps) {
    super(scope, id, props);

    // ================================
    // Setup EFS storage and access point
    // TODO: Put this in shared infra. Can't right now because of this bug: https://github.com/aws/aws-cdk/issues/18759
    const mdmServerFileSystem = new efs.FileSystem(this, 'MdmServerEfsFileSystem', {
      vpc: props.vpc,
      removalPolicy: cdk.RemovalPolicy.DESTROY,  // TODO: probably want to change this to prevent accidental deletion in production
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_60_DAYS, // files are not transitioned to infrequent access (IA) storage by default
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE, // default
      outOfInfrequentAccessPolicy: efs.OutOfInfrequentAccessPolicy.AFTER_1_ACCESS, // files are not transitioned back from (infrequent access) IA to primary storage by default
    });
    
    const accessPoint = mdmServerFileSystem.addAccessPoint('MdmServerAccessPoint',{
      createAcl: {
        ownerGid: '1001',
        ownerUid: '1001',
        permissions: '750'
      },
      path:'/mdmserver',
      posixUser: {
        gid: '1001',
        uid: '1001'
      }
    });

    // ============================================================
    // Create lambda function that builds and bundles the Go server

    // Read this to understand how to bundle executables via the CDK: https://aws.amazon.com/blogs/devops/building-apps-with-aws-cdk/
    // For Go binaries, you can build via a container or build locally. We're using the 
    // container approach for repeatability, even though it's a little slower.
    //
    // The specific bundling params took a lot of trial-and-error to figure out. tread carefully.

    const lambdaId = 'nanomdm-lambda'
    const lambdaStoragePath = '/mnt/mdmserver'  // this is where nanomdm lambda will store files

    const buildEnvironment = {
      CGO_ENABLED: '0',
      GOOS: 'linux',
      GOARCH: 'amd64', // alt: arm64
    };

    // We need to build from repo root in order to copy the secrets into this function bundle.
    const buildRootPath = path.join(__dirname, '..')
    const bundlingOptions: cdk.BundlingOptions = {
      user: "root",
      image: lambda.Runtime.GO_1_X.bundlingImage,
      environment: buildEnvironment,
      command: [
        'bash', '-c', [
          `cp ${props.certificatePath} /asset-output`, // This must happen before the next line
          'cd mdmserver/nanomdm && go build -buildvcs=false -o /asset-output/main ./cmd/nanomdm',
        ].join(' && ')
      ],
    }

    const nanomdmEnvFlags = {
      MDM_CA: 'scep_ca.pem',
      MDM_STORAGE: 'file',
      MDM_DSN: path.join(lambdaStoragePath, "db"),
      MDM_LAMBDA: 'true',
      MDM_API: props.apiPassword,
      MDM_DEBUG: 'true',
      GODEBUG: 'x509sha1=1'                         // required because go 1.18 deprecated SHA1 support, which Apple use. This flag re-enables SHA1 support: https://github.com/golang/go/issues/41682
    }

    // There's a GoFunction construct that's supposed to make this a lot easier, but I hit a bunch of errors
    // and didn't want to waste time, so I'm going with the vanilla lambda Function construct.
    // I followed these instructions: https://aws.amazon.com/blogs/devops/building-apps-with-aws-cdk/
    const mdmserverFunction = new lambda.Function(this, lambdaId, {
      runtime: lambda.Runtime.GO_1_X,
      architecture: lambda.Architecture.X86_64,
      handler: 'main',
      code: lambda.Code.fromAsset(buildRootPath, {
        assetHash: cdk.AssetHashType.OUTPUT,
        bundling: bundlingOptions,
      }),
      environment: nanomdmEnvFlags,
      filesystem: lambda.FileSystem.fromEfsAccessPoint(accessPoint, lambdaStoragePath),
      vpc: props.vpc
    });

    // ==============================================================
    // Create an API Gateway that proxies all requests to our function
    this.api = new LambdaRestApi(this, 'mdmServerAPI', {
      handler: mdmserverFunction
    })

    // ===========================
    // Export parameters
    new cdk.CfnOutput(this, 'mdmServerUrlRef', {
      value: this.api.url,
      description: 'The URL for the MDM server',
      exportName: 'mdmServerUrl'
    });

    // create an SSM parameter which stores export values
    new ssm.StringParameter(this, 'mdmServerUrl', {
      parameterName: `/mdmServerStack/serverUrl`,
      stringValue: this.api.url
    })

  }
}
