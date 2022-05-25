#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { SharedInfraStack } from './shared_infrastructure';
import { MDMServerStack } from './mdmserver/infrastructure'
import { SCEPServerStack } from './scepserver/infrastructure';
import { MDMProfileServerStack } from './mdmProfileServer/infrastructure';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

const app = new cdk.App();

// Load config from the CDK context (stored in cdk.context.json)
interface IEnvironmentConfig {
  readonly scepCertificatePath: string;
  readonly scepPrivateKeyPath: string;
  readonly scepChallengePassword: string;
  readonly mdmApiPassword: string;
  readonly mdmApnsTopic: string;
}
const environment: string = process.env.ENV_NAME || 'local';
const environmentConfig: IEnvironmentConfig = app.node.tryGetContext(environment);

interface MDMStackProps extends cdk.StackProps {
  envConfig: IEnvironmentConfig
}

class MDMStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MDMStackProps ) {
      super(scope, id, props);

      // Shared infrastructure constructs (VPC, EFS Filesystem)
      const infra = new SharedInfraStack(app, 'SharedInfraStack');

      // Launch SCEP server stack
      const scepServer = new SCEPServerStack(app, 'SCEPServerStack', {
        vpc: infra.vpc,
        certificatePath: props.envConfig.scepCertificatePath,
        privateKeyPath: props.envConfig.scepPrivateKeyPath,
        challengePassword: props.envConfig.scepChallengePassword,
      });

      // Launch MDM server stack
      const mdmServer = new MDMServerStack(app, 'MDMServerStack', {
        vpc: infra.vpc,
        apiPassword: props.envConfig.mdmApiPassword,
        certificatePath: props.envConfig.scepCertificatePath,
      });

      // Retrieve the SCEP and MDM server URL values so that we can pass them to the Profile generator
      // NOTE: valueFromLookup() will get the value _at synthesis time_, which is important for us.
      // If we used valueForStringParameter() it would use a placeholder token, which would fail because 
      // we're using these values in the profile config.
      const mdmServerUrl = ssm.StringParameter.valueFromLookup(this, '/mdmServerStack/serverUrl')
      const scepServerUrl = ssm.StringParameter.valueFromLookup(this, '/scepServerStack/serverUrl')

      //Deploy the MDM profile
      const mdmProfileServer = new MDMProfileServerStack(app, 'MDMProfileServerStack', {
        scepServerUrl: scepServerUrl,
        scepChallengePassword: props.envConfig.scepChallengePassword,
        mdmServerUrl: mdmServerUrl,
        mdmApnsTopic: props.envConfig.mdmApnsTopic,
      })
  }
}

new MDMStack(app, 'MDMStack', { 
  envConfig: environmentConfig,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  }
})