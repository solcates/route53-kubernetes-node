var Client = require("node-kubernetes-client");
var fs = require("fs"),
    AWS = require("aws-sdk")

var kubernetesService = process.env["KUBERNETES_SERVICE_HOST"];
// PATHS
var kubernetesCAFile = process.env["CA_FILE_PATH"] || "./ca.pem";
var kubernetesClientCert = process.env["CERT_FILE_PATH"] || "./cert.pem";
var kubernetesClientKey = process.env["KEY_FILE_PATH"] || "./key.pem";
var awsCredentials = process.env["AWS_SHARED_CREDENTIALS_FILE"] || "./credentials";

// Base64 Environment Variables
var kubernetesCAData = process.env["CA_FILE_DATA"];
var kubernetesClientCertData = process.env['CERT_FILE_DATA'];
var kubernetesClientKeyData = process.env['KEY_FILE_DATA'];
var awsCredentialsData = process.env["AWS_SHARED_CREDENTIALS_DATA"];

if (kubernetesCAData) {
    fs.writeFileSync("./ca.pem", new Buffer(kubernetesCAData, 'base64').toString("utf8"))
    kubernetesCAFile = "./ca.pem";
}
if (kubernetesClientCertData) {
    fs.writeFileSync("./cert.pem", new Buffer(kubernetesClientCertData, 'base64').toString("utf8"));
    kubernetesClientCert = "./cert.pem";
}
if (kubernetesClientKeyData) {
    fs.writeFileSync("./key.pem", new Buffer(kubernetesClientKeyData, 'base64').toString("utf8"))
    kubernetesClientKey = "./key.pem"
}
if (awsCredentialsData) {
    fs.writeFileSync("./credentials", new Buffer(awsCredentialsData, 'base64').toString("utf8"));
    awsCredentials = "./credentials"
}

var awsRegion = process.env["AWS_DEFAULT_REGION"] || "us-west-2"
var loopInterval = process.env["LOOP_INTERVAL"] || "5000"
var debug;
if (process.env["DEBUG"] == "true") {
    debug = true;
} else {
    debug = false;
}

var timeout = parseInt(loopInterval);


// Setup K8S client
var client = new Client({
    host: kubernetesService,
    protocol: 'https',
    version: 'v1',
    ca: fs.readFileSync(kubernetesCAFile, "utf8"),
    cert: fs.readFileSync(kubernetesClientCert, "utf8"),
    key: fs.readFileSync(kubernetesClientKey, "utf8")

});

// Setup credentials for our AWS clients... ELB and Route53
var credentials = new AWS.SharedIniFileCredentials({filename: awsCredentials, profile: "default"});
AWS.config.credentials = credentials;
AWS.config.region = awsRegion;
var awsELBClient = new AWS.ELB();
var awsR53Client = new AWS.Route53();


// Update DNS records (CREATE and UPSERT)
var updateDNS = function (action, zone_id, domainName, elb_address) {
    var params = {
        "HostedZoneId": zone_id, // our Id from the first call
        "ChangeBatch": {
            "Changes": [
                {
                    "Action": action,
                    "ResourceRecordSet": {
                        "Name": domainName,
                        "Type": "CNAME",
                        "TTL": 60,
                        "ResourceRecords": [
                            {
                                "Value": elb_address
                            }
                        ]
                    }
                }
            ]
        }
    };
    // console.log(params)
    awsR53Client.changeResourceRecordSets(params, function (err, result) {
        if (err) {
            console.error(err)
        } else {
            // Successfully updated your record... not much to do now :)
        }
    })
}


// Workloop to poll for route53 mapped services
var workLoop = function (done) {
    // Get All Services
    client.services.get(function (err, services) {
        if (err) {
            console.error(err)
        }
        services[0].items.forEach(function (item) {
            // Look for those with dns=route53 annotations
            if (item.metadata) {
                if (item.metadata.labels) {
                    if ("dns" in item.metadata.labels) {
                        if (item.metadata.annotations) {
                            if (item.metadata.annotations.domainName) {
                                if (item.status.loadBalancer.ingress) {
                                    var lbpoint = item.status.loadBalancer.ingress[0].hostname;
                                    var domainName = item.metadata.annotations.domainName;
                                    var domainRoot = domainName.substring(domainName.indexOf(".") + 1) + "."
                                    awsELBClient.describeLoadBalancers(function (err, lbs) {
                                        if (err) {
                                            console.error("Error describing ELB", err);
                                        } else {
                                            // Loop through ELBs looking for our services match...
                                            lbs.LoadBalancerDescriptions.forEach(function (lb) {
                                                // find match...
                                                if (lb.DNSName == lbpoint) {
                                                    // Get the domains hostedZone ID
                                                    awsELBClient.describeInstanceHealth({LoadBalancerName: lb.LoadBalancerName}, function (err, data) {
                                                        if (err) {
                                                            console.error(err)
                                                        } else {
                                                            var ready = true;
                                                            data.InstanceStates.forEach(function (instance) {
                                                                if (instance.State != "InService") {
                                                                    ready = false;
                                                                }
                                                            })
                                                            if (ready) {
                                                                awsR53Client.listHostedZones(function (err, data) {
                                                                    if (err) {
                                                                        console.error(err)
                                                                    } else {
                                                                        // console.log(data.HostedZones)
                                                                        var zones = data.HostedZones;
                                                                        zones.forEach(function (zone) {
                                                                            if (zone.Name == domainRoot) {
                                                                                var updated = false;
                                                                                awsR53Client.listResourceRecordSets({HostedZoneId: zone.Id}, function (err, recordset) {
                                                                                    // console.log("zonelist", recordset)
                                                                                    recordset.ResourceRecordSets.forEach(function (record) {
                                                                                            // console.log(record)
                                                                                            if (record.Name == (domainName + ".")) {
                                                                                                updated = true;
                                                                                                var rr = record.ResourceRecords[0]
                                                                                                if (rr.Value == lb.DNSName) {
                                                                                                    if (debug) {
                                                                                                        console.log("Recordset already set for:", domainName)
                                                                                                    }
                                                                                                } else {

                                                                                                    console.log("Changing ResourceSet:", domainName, "=>", lb.DNSName);
                                                                                                    updateDNS("UPSERT", zone.Id, domainName, lb.DNSName)
                                                                                                }

                                                                                            }
                                                                                        }
                                                                                    )
                                                                                    if (!updated) {
                                                                                        console.log("Inserting ResourceSet:", domainName, "=>", lb.DNSName);

                                                                                        updateDNS("CREATE", zone.Id, domainName, lb.DNSName)
                                                                                    }
                                                                                })
                                                                            }
                                                                        })
                                                                    }
                                                                })
                                                            } else {
                                                                if (debug) {
                                                                    console.log("waiting for ELB to be inservice before swapping DNS entries")

                                                                }
                                                            }
                                                        }
                                                    })

                                                }
                                            })
                                        }
                                    })
                                } else {
                                    if (debug) {
                                        console.log("Loadbalancer not ready for service:", item.metadata.name)

                                    }
                                }
                            } else {
                                if (debug) {
                                    console.error("No domainName annotation for service:", item.metadata.name)

                                }
                            }
                        } else {
                            if (debug) {
                                console.error("No domainName annotation for service:", item.metadata.name)

                            }
                        }
                    }
                }

            }

        })
        setTimeout(function () {
            workLoop();
        }, timeout)
    })
}


workLoop()

