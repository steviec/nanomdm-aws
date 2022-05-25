Secrets
========

Use this folder to place any secrets needed for the services (certs, keys). We will eventually migrate these the AWS Secrets Manager.

Ones the CDK deploy script looks for:
- scep_ca.key    # private key for SCEP server, copied into bundle. This can be manually generated.
- scep_ca.pem    # public cert for SCEP server, copied into bundle. This can be manually generated.
- apns_push.key  # this is our private key that we generated for our push notification; will be manually uploaded via the /pushcert endpoint on the MDM server
- apns_push.pem  # this is the public cert that Apple grants us; will be manually uploaded via the /pushcert endpoint on the MDM server

For instructions on obtaining an APNS push certificate, see the documentation [here](https://github.com/micromdm/nanomdm/blob/main/docs/quickstart.md).