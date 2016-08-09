# Kubernetes => Route53 Mapping Service in Node.js

This is a Kubernetes service that polls services (in all namespaces) that are configured
with the label `dns=route53` and adds the appropriate alias to the domain specified by
the annotation `domainName=sub.mydomain.io`.

# Setup

### Build the Image

You may choose to use Docker images for route53-kubernetes-node image from solcates/route53-kubernetes-node or build the docker image, and push the docker image to your own registry. S

Note: Use this image at your own risk.

### route53-kubernetes-node ReplicationController

The following is an example ReplicationController definition for route53-kubernetes:

```yaml
apiVersion: v1
kind: ReplicationController
metadata:
  name: route53-kubernetes
  namespace: kube-system
  labels:
    app: route53-kubernetes
spec:
  replicas: 1
  selector:
    app: route53-kubernetes
  template:
    metadata:
      labels:
        app: route53-kubernetes
    spec:
      volumes:
        - name: ssl-cert
          secret:
            secretName: kube-ssl
        - name: aws-creds
          secret:
            secretName: aws-creds
      containers:
        - image: solcates/route53-kubernetese-node
          name: route53-kubernetes
          volumeMounts:
            - name: ssl-cert
              mountPath: /opt/certs
              readOnly: true
            - name: aws-creds
              mountPath: /opt/creds
              readOnly: true
          env:
            - name: "CA_FILE_PATH"
              value: "/opt/certs/ca.pem"
            - name: "CERT_FILE_PATH"
              value: "/opt/certs/cert.pem"
            - name: "KEY_FILE_PATH"
              value: "/opt/certs/key.pem"
            - name: "AWS_SHARED_CREDENTIALS_FILE"
              value: "/opt/creds/credentials"
```

Create the ReplicationController via `kubectl create -f <name_of_route53-kubernetes-rc.yaml>`

### Service Configuration

Given the following Kubernetes service definition:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: my-app
  labels:
    app: my-app
    role: web
    dns: route53
  annotations:
    domainName: "test.mydomain.com"
spec:
  selector:
    app: my-app
    role: web
  ports:
  - name: web
    port: 80
    protocol: TCP
    targetPort: web
  - name: web-ssl
    port: 443
    protocol: TCP
    targetPort: web-ssl
  type: LoadBalancer
```

An "A" record for `test.mydomain.com` will be created as an alias to the ELB that is
configured by kubernetes. This assumes that a hosted zone exists in Route53 for mydomain.com.
Any record that previously existed for that dns record will be updated.

This service expects that it's running on a Kubernetes node on AWS and that the IAM profile for
that node is set up to allow the following, along with the default permissions needed by Kubernetes:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": "route53:ListHostedZonesByName",
            "Resource": "*"
        },
        {
            "Effect": "Allow",
            "Action": "elasticloadbalancing:DescribeLoadBalancers",
            "Resource": "*"
        },
        {
            "Effect": "Allow",
            "Action": "route53:ChangeResourceRecordSets",
            "Resource": "*"
        }
    ]
}
```