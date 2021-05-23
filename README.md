# vscode-remote-container

This is a workspace template for general AWS CDK developement in local Visual Studio Code.

## Create AWS CDK App

```bash
npx projen new awscdk-app-ts
```

## Create AWS CDK Construct Lib

```bash
npx projen new awscdk-construct
```
## Refresh your AWS credentiail 

```bash
bin/refresh_credentials.sh $profile
## Note: check devcontainer.json file
## 1. This profile can assume an admin role that match with   $assume_role_name 
## 2. Mount your .aws folder to container
```

## Start your CDK development

You should be able to run the CDK CLI now.

```sh
$ cdk diff
$ cdk deploy
$ cdk destroy
```