import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as efs from 'aws-cdk-lib/aws-efs';

// Used this as inspiration: https://towardsthecloud.com/library/aws-cdk-share-resources-across-stacks
export class SharedInfraStack extends cdk.Stack {

    public readonly vpc: ec2.Vpc;
    public readonly efs: efs.FileSystem;

    constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
      super(scope, id, props);
  
      // assign a VPC to the class property SharedInfraStack
      this.vpc = new ec2.Vpc(this, 'VPC', {
        maxAzs: 2, // Default is all AZs in the region
      });
    }
  }