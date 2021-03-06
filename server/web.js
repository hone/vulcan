require.paths.unshift(__dirname + '/lib');

var cradle  = require('cradle');
var express = require('express');
var fs      = require('fs');
var spawner = require('spawner').create();
var sys     = require('sys');
var uuid    = require('node-uuid');

var app = express.createServer(
  express.logger(),
  express.cookieParser(),
  express.session({ secret: process.env.SECRET }),
  require('connect-form')({ keepExtensions: true })
);

var couchdb_url = require('url').parse(process.env.CLOUDANT_URL);

var couchdb_options = couchdb_url.auth ?
  {
    auth: { username: couchdb_url.auth.split(':')[0], password: couchdb_url.auth.split(':')[1] }
  } :
  { }

var db = new(cradle.Connection)(couchdb_url.hostname, couchdb_url.port || 5984, couchdb_options).database('make');

db.create();

app.post('/make', function(request, response, next) {
  if (! request.form) {
    response.send('invalid');
  } else {
    request.form.complete(function(err, fields, files) {
      if (err) {
        next(err);
      } else {
        if (fields.secret != process.env.SECRET) {
          response.send(500);
        } else {
          var id      = uuid();
          var command = fields.command;
          var prefix  = fields.prefix;

          var doc = db.save(id, { command:command, prefix:prefix }, function(err, doc) {
            db.saveAttachment(
              doc.id,
              doc.rev,
              'input',
              'application/octet-stream',
              fs.createReadStream(files.code.path),
              function(err, data) {
                var ls = spawner.spawn('bin/make ' + id, function(err) {
                  console.log('couldnt spawn: ' + err);
                });

                ls.on('error', function(error) {
                  response.writeHead(500);
                  console.log('error: ' + error);
                  response.end();
                });

                ls.on('data', function(data) {
                  response.write(data);
                });

                ls.on('exit', function(code) {
                  response.end();
                });
              }
            );

            response.header('X-Make-Id', id);
          });
        }
      }
    });
  }
});

app.get('/output/:id', function(request, response, next) {
  var stream = db.getAttachment(request.params.id, 'output');

  stream.on('data', function(chunk) {
    response.write(chunk, 'binary');
  });

  stream.on('end', function(chunk) {
    response.end();
  });
});

var port = process.env.PORT || 3000;
console.log('listening on port ' + port);
app.listen(port);
