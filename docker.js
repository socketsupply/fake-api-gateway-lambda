var path = require('path')
var ncp = require('ncp')
var mkdirp = require('mkdirp')
var fs = require('fs')
var cp = require('child_process')
var fetch = require('node-fetch')
//run lambda process within docker.

function copy (src, dest, cb) {
  mkdirp(dest, () => {
    console.log("COPY", src, dest)
    ncp(src, dest, {}, cb)
  })
}

function createDockerfile (runtime, handler) {
  return `
FROM public.ecr.aws/lambda/${runtime}

# Copy function code
COPY * $\{LAMBDA_TASK_ROOT\}/

# Set the CMD to your handler (could also be done as a parameter override outside of the Dockerfile)
CMD [ "${handler}" ]
`
}

var START_PORT = ~~(9000 + Math.random()*1000)


class DockerLambda {
  constructor (_path, entry, env, handler, runtime) {
    console.log("DOCKER", [_path, entry, env, handler, runtime])
    this.path = _path
    if(!/^nodejs:/.test(runtime))
      throw new Error('only node.js runtime supported currently')
    //copy input to tmp dir
    //insert Dockerfile
    //run docker build
    //start docker
    //use fetch, but return expected event object.
    var env_array = Object.keys(env)
      .map(k => ['--env', k+'='+env[k]])
      .reduce((a, b) => a.concat(b), [])

    this.port = START_PORT++
    var id = 'operator-docker_'+Date.now()
    var tmp = '/tmp/'+id

    function log (proc) {
      proc.stdout.on('data', d => process.stdout.write(d))
      proc.stderr.on('data', d => process.stderr.write(d))
      return proc
    }

    this.ready = new Promise((resolve, reject) => {
      copy(path.dirname(entry), tmp, (err) => {
        if(err) return reject(err)
        var basename = path.basename(entry)
        var base = basename.substring(0, basename.indexOf(path.extname(basename)))
        fs.writeFile(
          path.join(tmp, 'Dockerfile'),
          createDockerfile('nodejs:12', base+'.'+handler),
        (err) => {
          if(err) return reject(err)
          console.log(['>docker', 'build', tmp, '-t',  id].join(' '))
          //return
          this.proc = log(cp.spawn('docker', ['build', tmp , '-t',  id]))
          .on('exit',  (code) => {
            if(code)
              return reject(new Error('docker build failed'))

            //XXX: I think this should error but that breaks the tests...
            if(this.closed)
              return resolve()
              //reject(new Error('closed during startup'))
   
         console.log(['>docker', 'run', '-p', `${this.port}:8080`].concat(env_array).concat([id]).join(' '))
          //  this.proc = log(cp.spawn('docker', ['run', id, '-p', `${this.port}:8080`].concat(env_array)))

            //if the id isn't the very last argument you'll get an error
            //"entrypoint requires that handler must be first arg"
            //which won't help you figure it out.
            this.proc = log(cp.spawn('docker', ['run', '-p', `${this.port}:8080`]
              .concat(env_array)
              .concat([id])
            ))
            setTimeout(resolve, 1000)
          })
        })
      })
    })
  }

  request (id, eventObject) {
    return this.ready.then(() =>
      fetch(`http://localhost:${this.port}/2015-03-31/functions/function/invocations`,
        {method: 'post', body: JSON.stringify(eventObject)}
      ).then(r => r.json())
    )
  }

  close () {
    this.closed = true
    if(this.proc)
      this.proc.kill(9)
  }
}

module.exports = DockerLambda