var nodes = {};
var selectedNode = null;

function initData() {
    refreshReports = function() {
        for (var i in nodes) { refreshReportsData(nodes[i]); }
        setTimeout(function() { refreshReports() }, 2000);
    };
    refreshReports();
}
function getIdFromString(str) {
    return str.replace(/[^a-zA-Z0-9-]/g,'-');
}
function getNodeId(name) {
    var parts = name.split(':');
    if (parts.length == 1)
        return getIdFromString(name) + "-8000";
    return getIdFromString(name);
}
function getNodeObject(name) {
    var nodeId = getNodeId(name);

    if (nodes[nodeId]) return nodes[nodeId];
    var node = nodes[nodeId] = {
        id: nodeId,
        name: name,
        reports: {}
    };

    return node;
}
function deleteNodeObject(node) {
    if (!node) return;
    nodes[node.id] = null;
}

// Stubs
function getTests(nodeId) {
    return ['Read', 'Read+Write']
}
function refreshReportsData(node) {
    $.getJSON('http://' + node.name + '/data/', function(data) {
        node.reports = data;
    });
}

function randomize(list) {
    return list.map(function(x) { 
        var rnd = [x[0]];
        for (var i = 1; i < x.length; i++) {
            rnd[i] = Math.random() * x[i];
        }
        return rnd;
    });
}