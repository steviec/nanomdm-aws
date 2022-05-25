import { Construct } from 'constructs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as lambda from "aws-cdk-lib/aws-lambda"
import { LambdaRestApi } from 'aws-cdk-lib/aws-apigateway';

import * as path from "path";


export interface SCEPServerStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  challengePassword: string;
  certificatePath: string;
  privateKeyPath: string;
}

export class SCEPServerStack extends cdk.Stack {
  public readonly api: LambdaRestApi;

  constructor(scope: Construct, id: string, props: SCEPServerStackProps) {
    super(scope, id, props);

    // ================================
    // Setup EFS storage and access point
    // TODO: Put this in shared infra. Can't right now because of this bug: https://github.com/aws/aws-cdk/issues/18759
    const scepServerFileSystem = new efs.FileSystem(this, 'SCEPServerEfsFileSystem', {
      vpc: props.vpc,
      removalPolicy: cdk.RemovalPolicy.DESTROY,  // TODO: probably want to change this to prevent accidental deletion in production
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_60_DAYS, // files are not transitioned to infrequent access (IA) storage by default
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE, // default
      outOfInfrequentAccessPolicy: efs.OutOfInfrequentAccessPolicy.AFTER_1_ACCESS, // files are not transitioned back from (infrequent access) IA to primary storage by default
    });
    
    const accessPoint = scepServerFileSystem.addAccessPoint('SCEPServerAccessPoint',{
      createAcl: {
        ownerGid: '1001',
        ownerUid: '1001',
        permissions: '750'
      },
      path:'/scepserver',
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

    const lambdaId = 'scepserver-lambda'
    const lambdaStoragePath = '/mnt/scepserver'  // this is where scep lambda will store files

    const buildRootPath = path.join(__dirname, '..')
    const bundlingOptions: cdk.BundlingOptions = {
      user: "root",
      image: lambda.Runtime.GO_1_X.bundlingImage,         
      environment: {
        CGO_ENABLED: '0',
        GOOS: 'linux',
        GOARCH: 'amd64', // alt: arm64
      },
      command: [
        'bash', '-c', [
          `cp ${props.certificatePath} /asset-output/scep_ca.pem`, // We must copy these over before the directory change for the build
          `cp ${props.privateKeyPath} /asset-output/scep_ca.key`, 
          'cd scepserver/scep && go build -buildvcs=false -o /asset-output/main ./cmd/scepserver',     
        ].join(' && ')
      ]
    }
    
    const scepServerEnvFlags = {
      SCEP_CHALLENGE_PASSWORD: props.challengePassword,
      SCEP_CERT_RENEW: '0',      
      SCEP_FILE_DEPOT: path.join(lambdaStoragePath, "depot"),
      SCEP_INIT_CA: 'true',
      SCEP_LAMBDA: 'true',
      SCEP_PATH_CERT: 'scep_ca.pem',
      SCEP_PATH_KEY: 'scep_ca.key',
      SCEP_LOG_DEBUG: 'true'
    }

    const scepserverFunction = new lambda.Function(this, lambdaId, {
      runtime: lambda.Runtime.GO_1_X,
      architecture: lambda.Architecture.X86_64,
      handler: 'main',
      code: lambda.Code.fromAsset(buildRootPath, {
        assetHash: cdk.AssetHashType.OUTPUT,
        bundling: bundlingOptions
      }),
      environment: scepServerEnvFlags,
      timeout: cdk.Duration.seconds(10),
      filesystem: lambda.FileSystem.fromEfsAccessPoint(accessPoint, lambdaStoragePath),
      vpc: props.vpc
    });

    this.api = new LambdaRestApi(this, 'scepServerAPI', {
      handler: scepserverFunction,
      binaryMediaTypes: ['*/*']
    })

    new cdk.CfnOutput(this, 'scepServerUrlRef', {
      value: this.api.url,
      description: 'The URL for the SCEP server',
      exportName: 'scepServerUrl'
    });

    // create an SSM parameter which stores export values
    new ssm.StringParameter(this, 'scepServerUrl', {
      parameterName: `/scepServerStack/serverUrl`,
      stringValue: this.api.url
    })
  }
}
