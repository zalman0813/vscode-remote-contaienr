import * as elbv2 from '@aws-cdk/aws-elasticloadbalancingv2';
import * as cloudfront from '@aws-cdk/aws-cloudfront';
import * as origins from '@aws-cdk/aws-cloudfront-origins';
import * as cdk from '@aws-cdk/core';
import * as route53 from '@aws-cdk/aws-route53';
import * as targets from '@aws-cdk/aws-route53-targets';
import * as certificatemanager from '@aws-cdk/aws-certificatemanager';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';

export interface WebProps {

}

export class Web extends cdk.Construct {
  constructor(scope: cdk.Construct, id: string) {
    super(scope, id);

    const vpcId = 'vpc-0353b70fd91e434cc';
    const clusterName = 'dev-qts-infra-dev-qts-ecs--stack-devqtsecscluster1E8E2DC7-VywyCXehqZuZ';
    const vpc = ec2.Vpc.fromLookup(this, `qts-vpc`, {vpcId:vpcId});
    const SecurityGroupEcsFargate = new ec2.SecurityGroup(this, 'SecurityGroupEcsFargate', {
      vpc: vpc,
      allowAllOutbound: true,
      description: 'Security Group for Fargate'
    });
    const cluster = ecs.Cluster.fromClusterAttributes(this, `qts-ecs`, 
      { clusterName: clusterName, 
        vpc: vpc, 
        securityGroups: [SecurityGroupEcsFargate],
        });
    // previously created route 53 hosted zone 
    const hostZone = route53.PublicHostedZone.fromLookup(this, `qts-host-zone`, {domainName: 'focuspointdev.com'})

    // SSL certificate for the domain 
    const cert = new certificatemanager.Certificate(
      this,
      "certificate",
      {
        domainName: "demo.focuspointdev.com",
        validation: certificatemanager.CertificateValidation.fromDns(hostZone),
      }
    );
    const certAcross = new certificatemanager.DnsValidatedCertificate(this, `cross-region-certificate`, {
      domainName: "cdn.demo.focuspointdev.com",
      hostedZone: hostZone,
      region: 'us-east-1',
    });;
    // Application load balancer
    // exposing the public facing frontend service to the public.
    const alb = new elbv2.ApplicationLoadBalancer(this, 'external', {
        vpc: vpc,
      internetFacing: true
    });
    // cloudfront distribution
    const distribution = new cloudfront.Distribution(this, `cf-distribution`, {
      // defaultBehavior: { origin: new origins.LoadBalancerV2Origin(alb) },
      defaultBehavior: {origin: new origins.HttpOrigin('demo.focuspointdev.com')},
      domainNames: ["cdn.demo.focuspointdev.com"],
      certificate: certAcross,
    });
    
    new route53.ARecord(this, 'CDN-Alias', {
      zone: hostZone,
      recordName: "cdn.demo.focuspointdev.com", 
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution))
    });
    new route53.AaaaRecord(this, 'CDN-Alias-AAAA', {
      zone: hostZone,
      recordName: "cdn.demo.focuspointdev.com", 
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution))
    });
    
    new route53.ARecord(this, 'Alias', {
      zone: hostZone,
      recordName: "demo.focuspointdev.com", 
      target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(alb))
    });
    new route53.AaaaRecord(this, 'Alias-AAAA', {
      zone: hostZone,
      recordName: "demo.focuspointdev.com", 
      target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(alb))
    });

    // Target group to make resources containers dicoverable by the application load balencer
    const targetGroupHttp = new elbv2.ApplicationTargetGroup(
      this,
      "target-group",
      {
        port: 80,
        vpc,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targetType: elbv2.TargetType.IP,
      }
    );

    // Health check for containers to check they were deployed correctly
    targetGroupHttp.configureHealthCheck({
      path: "/",
      protocol: elbv2.Protocol.HTTP,
      interval: cdk.Duration.minutes(1),
    });

    // only allow HTTPS connections 
    const listener = alb.addListener("alb-listener", {
      open: true,
      port: 443,
      certificates: [cert],
    });

    listener.addTargetGroups("alb-listener-target-group", {
      targetGroups: [targetGroupHttp],
    });

    // use a security group to provide a secure connection between the ALB and the containers
    const albSG = new ec2.SecurityGroup(this, "alb-SG", {
      vpc,
      allowAllOutbound: true,
    });

    albSG.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      "Allow https traffic"
    );

    alb.addSecurityGroup(albSG);
    // Security groups to allow connections from the application load balancer to the fargate containers
    const ecsSG = new ec2.SecurityGroup(this, "ecsSG", {
      vpc,
      allowAllOutbound: true,
    });

    ecsSG.connections.allowFrom(
      albSG,
      ec2.Port.allTcp(),
      "Application load balancer"
    );

    // A really basic task definition
    const taskDefinition = new ecs.FargateTaskDefinition(
      this,
      "task",
      {
        family: "test-lumen-td",
        cpu: 512,
        memoryLimitMiB: 1024,
      }
    );

    // The docker container including the image to use
    const container = taskDefinition.addContainer("container", {
      image:  ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      memoryLimitMiB: 512,
      environment: {
        SERVER_QTS_URL: `http://swagger.internal:8080/QTS/`,
      },
      healthCheck: {
        command: [
          "CMD-SHELL", 
          "curl -f http://localhost || exit 1" 
        ],
        startPeriod: cdk.Duration.seconds(10),
            interval: cdk.Duration.seconds(5),
            timeout: cdk.Duration.seconds(2),
            retries: 5
          },
      // store the logs in cloudwatch 
      logging: ecs.LogDriver.awsLogs({ streamPrefix: "lumen-logs" }),
    });

    // the docker container port mappings within the container
    container.addPortMappings({ containerPort: 80 });

    // The ECS Service used for deploying tasks 
    const service = new ecs.FargateService(this, "service", {
      cluster,
      desiredCount: 1,
      taskDefinition,
      securityGroups: [ecsSG],
      assignPublicIp: true,
    });
    // add to a target group so make containers discoverable by the application load balancer
    service.attachToApplicationTargetGroup(targetGroupHttp);

    // new cdk.CfnOutput(this, "id", {
    //   value: "",
    //   exportName: "id"
    // })
  }
}