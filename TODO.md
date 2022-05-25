TODO
=====
Stuff that would be nice to get to.

## Store certs in AWS Secrets Manager
There are four key files that are important:
- CA public/private key (SCEP needs both, MDM needs the public cert)
- APNS Push public/private key (MDM needs this to communicate to APNS)

We should be storing these in a centralized location (e.g. AWS Secrets Manager) and passing them to the functions to use. This might be tricky because 1) both scep and mdm have hardcoded locations they use for loading certs, and 2) we need to get those certs onto the lambda function. Options:
- ~~hard code the certs into lambda function ENV vars (during CDK deploy) and teach the function how to import them~~. [**I tried this, lambda ENV vars aren't large enough to handle.**]
- copy the certs into the lambda bundle, then teach the SCEP and MDM server to load those from a differet location [**I went this route**]
- add code to the lambda function to contact secrets manager directly 
- bake the certs into a separate lambda layer, and teach the function how to load them from a place different from the depot/db

Note: currently we are copying over the cert/key on every request to the SCEP server. This is not a good solution.

## Faster Go bundling
I'm not sure what the best path is for Go building/bundling, but the current Docker-based setup is excruciatingly slow. Options:
- keep Docker (it makes things consistent), but speed it up. Don't do `go get` and whatnot.
- use local builds, but force specific Go versions to avoid issues (e.g. the SHA1 deprecation in Go 1.18!)

Read this: https://dev.to/aws-builders/aws-cdk-fullstack-polyglot-with-asset-bundling-318h

## Avoid unnecessary setup/teardown manual steps
It would be nice to add a CDK trigger to upload the push certs to the Nanomdm server so this isn't a manual post deploy step.

## Cleanup scep and nanomdm submodules
I added a bunch of gunk in there, should clean out and add tests for the stuff I did add.

## Profile creation
Right now we are creating a Profile based on a values generated at deploy-time by the CDK. We rely on the MDM and SCEP server endpoints to be known so that we can put those in the mobileconfig file. Unfortunately, this leads to a lot of additional complexity:
- cross-stack shared variables
- using the Paramter Store to save the URL values
- synth/deplying the MDM and SCEP servers first before the whole stack.

We should probably just move to using a lambda function that generates the profile on-the-fly and can lookup the server urls. Alternatively, we could use an L3 construct for the profile generation originally proposed in this issue: https://github.com/aws/aws-cdk/issues/20063 that allows us to pass deploy-time variables to a subsequent build step. Construct here: https://github.com/tmokmss/deploy-time-build

This would also allow us to not have to pre-deploy the MDM and SCEP servers to populate the SSM Parameter Store, which would be nice.
