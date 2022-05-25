NanoMDM on AWS
=====================

This repo builds and configures a nanomdm server to run on AWS lambda. It uses the Cloud Development Kit and tries to follow best practices. It uses 4 stacks:
- SharedInfrastructure: configures a shared VPC instance
- MDMServerStack: configures API Gateway, nanomdm in a lambda function, and a backend EFS filesystem
- SCEPServerStack: configures API Gateway, scep server in a lambda function, and a backend EFS filesystem
- MDMProfileServer: generates a simple enroll.mobileconfig file on S3 the devices can download


# Architecture

The project structure follows the [AWS Well-Architected Framework](https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html) by organizing the project directory structure into **logical units** (e.g. SCEP Server, MDM Server, etc). Each unit should have a directory and include the related infrastructure, runtime, and configuration code. I used [this recommendation](https://aws.amazon.com/blogs/developer/recommended-aws-cdk-project-structure-for-python-applications/) as guidance.

```
|-- mdmserver
|   |-- infrastructure.ts
|   |-- nanomdm                 # NanoMDM server (forked and submoduled)
|-- scepserver
|   |-- infrastructure.ts
|   |-- scep                    # MicroMDM's SCEP server (forked and submoduled)
|-- mdmProfileServer
|   |-- infrastructure.ts
|-- app.ts                      # main app entrypoint
|-- cdk.json                    # tells the CDK CLI how to deploy our app
|-- shared_infrastructure.ts    # infrastructure shared by multiple stacks

```


# Installation and setup

## Prerequisites

Make sure that you've run init and update for the submodules:
- `git submodule update --init --recursive`

Prerequisites:
- Install [Docker Desktop](https://docs.docker.com/desktop/mac/install/)
- Install the [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
- Configure the AWS CLI: `aws configure`
- Install the CDK CLI: `npm install -g aws-cdk`
- Install all NPM modules: `npm install`
- Install [Go](https://go.dev/doc/install)


## Configure your servers

Before building and deploying, you'll want to prepare your keys and secrets.
- add four files to the `secrets` folder: `scep_ca.key`, `scep_ca.pem`, `apns_push.key`, `apns_push.pem`. See [SECRETS](secrets/SECRETS.md) for details on the required secrets.
- update the `cdk.context.json`'s `local` stanza with your own parameters. The CDK will use this when starting servers, generating profiles, etc.

Note that we do not rely on the scep server to generate its own public cert/private key; we pass it in to provide more control over it.


## Build & Deploy

The first time you build/deploy your App into an AWS account, you need to bootstrap your environment: `cdk bootstrap`. 

Then we need to synth and deploy the SCEP and MDM server stacks first, because the profile server relies on the URL endpoints to be generated:
- `cdk synth MDMServerStack SCEPServerStack`
- `cdk deploy MDMServerStack SCEPServerStack`

After that, synth & deploy the full app with `cdk synth && cdk deploy --all`.

The deploy output should contain a bunch of useful variables (server urls and whatnot) you can use for testing.

## Testing basic functionality

The deploy should output a `MDMProfileServerStack.mdmProfileUrl`. That's the location of the enrollment profile that you can test installing.

To test that the servers are doing the right thing, try this:
- test SCEP server: `curl '<SCEP_SERVER_URL>/scep?operation=GetCACert' | openssl x509 -inform DER`
- test MDM server: `curl '<MDM_SERVER_URL>/version'`


## Config MDM Server for push notifications

The MDM server needs the APNS push certs to be able to speak to devices. Following [this guide](https://github.com/micromdm/nanomdm/blob/main/docs/quickstart.md), you'll need to do this next:

`cat ./secrets/apns_push.pem  ./secrets/apns_push.key | curl -T - -u 'nanomdm:<API_PASSWORD>' '<MDM_SERVER_URL>/v1/pushcert'`

And you can test it's working with this:

`./mdmserver/nanomdm/tools/cmdr.py -r | curl -T - -u 'nanomdm:<API_PASSWORD>' '<MDM_SERVER_URL>/v1/enqueue/<DEVICE_ID>'`

