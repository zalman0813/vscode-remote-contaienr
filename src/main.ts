import { App, Construct, Stack, StackProps } from '@aws-cdk/core';
import { Web } from './web';

export class MyStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    // define resources here...
    new Web(this, "CloudFront");
  }
}

// for development, use account/region from cdk cli
const devEnv  = { account: '290984360226', region: 'us-east-2' };
const app = new App();

new MyStack(app, 'demo-route53', { env: devEnv });
// new MyStack(app, 'my-stack-prod', { env: prodEnv });

app.synth();