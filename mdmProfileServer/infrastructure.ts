/**
 * Simple stack that deploys an enroll.mobileconfig file to S3 that can be used by devices
 * to register with our SCEP and MDM servers.
 * 
 * The required values for the config file are passed into the stack.
 */

import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3Deploy from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";

import * as path from "path";
import { readFileSync } from 'fs';

export interface MDMProfileServerStackProps extends cdk.StackProps {
  scepChallengePassword: string;
  scepServerUrl: string;
  mdmServerUrl: string;
  mdmApnsTopic: string;
}

export class MDMProfileServerStack extends cdk.Stack {

	constructor(scope: Construct, id: string, props: MDMProfileServerStackProps) {
	  super(scope, id, props);
  
    const websiteBucket = new s3.Bucket(this, 'MDMProfileBucket', {
      publicReadAccess: true,
    });

    const templateReplacementLookup = {
      "MDM_SERVER_URL": props.mdmServerUrl + "mdm",
      "SCEP_SERVER_URL": props.scepServerUrl + "scep",
      "SCEP_CHALLENGE_PASSWORD": props.scepChallengePassword,
      "MDM_APNS_TOPIC": props.mdmApnsTopic
    }
    
    const mdmProfileTemplate = readFileSync(path.join(__dirname, "enroll.mobileconfig.template"), { encoding: 'utf-8' })
    const mdmProfile = stringTemplateParser(mdmProfileTemplate, templateReplacementLookup);    
    
    // WARNING: Source.data will not work with cross-stack references, unfortunately. So we need to store these in SSM for now
    // until this issue can be resolved: https://github.com/aws/aws-cdk/issues/19257
    // So now the MDM and SCEP stacks are exporting an SSM parameter that this stack takes in
    const s3Deployment = new s3Deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3Deploy.Source.data("enroll.mobileconfig", mdmProfile)],
      destinationBucket: websiteBucket,
      destinationKeyPrefix: 'profile', // optional prefix in destination bucket
      contentDisposition: 'attachment; filename="enroll.mobileconfig"'
    });

    new cdk.CfnOutput(this, 'mdmProfileUrl', {
      value: websiteBucket.urlForObject("/profile/enroll.mobileconfig")
    });
  }
}

// Simple function that replaces all occurences of {{VARIABLE}} with VALUE
// replaces all {{VARIABLE}} in the lookup string with VALUE provided in the lookupObject.
//    e.g. {
//      "VARIABLE": value   
//    }
function stringTemplateParser(inputString: string, lookupObject: any) {
	const templateMatcher = /{{\s?([^{}\s]*)\s?}}/g;
	return inputString.replace(templateMatcher, (match, value) => {
	  return lookupObject[value];
	});
}