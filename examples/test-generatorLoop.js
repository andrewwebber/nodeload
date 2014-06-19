var http = require('http');
var sys = require('sys');
exports.getRequestLoop = function(finished, client) {
	var req = client.request('GET', '/');
	console.log('1');
        req.on('response', function(res) {
			finished({req: req, res: res});
		console.log('2');
                var req1 = client.request('GET', '/');
                req1.on('response', function(res) {
			console.log('3');
			finished({req: req, res: res});
                });
                req1.end();
            });
	req.end();
}
