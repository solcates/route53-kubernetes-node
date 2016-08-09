/*
    Simple tool to generate the PEM format files needed to run the route53-kubernetes-node replication controller.

    If no argument is passed, it will look to use the ~/.kube/config file by default..

    usage:  node generateKeys.js <PATH TO KUBE CONFIG YAML>

 */


var fs = require("fs");
var yaml = require("js-yaml");
function getUserHome() {
    return process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
}
function getKubeFile(){
    var kubeFile = getUserHome() + "/.kube/config";
    return kubeFile;
}
var kubeFile = process.argv[2] || getKubeFile();
try {
    var doc = yaml.safeLoad(fs.readFileSync(kubeFile, 'utf8'));
    // console.log(doc);
    var ca_data = new Buffer(doc.clusters[0].cluster["certificate-authority-data"],'base64');
    var cert_data = new Buffer(doc.users[0].user["client-certificate-data"], 'base64');
    var key_data = new Buffer(doc.users[0].user["client-key-data"],"base64");
    var ca_data_string = ca_data.toString("ascii")
    var cert_data_string = cert_data.toString("ascii")
    var key_data_string = key_data.toString("ascii")
    fs.writeFile("ca.pem", ca_data_string);
    fs.writeFile("cert.pem", cert_data_string);
    fs.writeFile("key.pem", key_data_string);

} catch (e) {
    console.log(e);
}