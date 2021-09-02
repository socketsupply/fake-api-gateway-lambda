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
  constructor (_path, entry, env, handler) {

    //copy input to tmp dir
    //insert Dockerfile
    //run docker build
    //start docker
    //use fetch, but return expected event object.
    var env_array = Object.keys(env)
      .map(k => ['--env', k+'='+env[k]])
      .reduce((a, b) => a.concat(b), [])

    this.port = START_PORT++
    var id = 'operator-docker_'+0//Date.now()
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
        fs.writeFile(path.join(tmp, 'Dockerfile'), createDockerfile('nodejs:12', base+'.'+handler), (err)=>{
          if(err) return reject(err)
          console.log(['>docker', 'build', tmp, '-t',  id].join(' '))
          //return
          this.proc = log(cp.spawn('docker', ['build', tmp , '-t',  id]))
          .on('exit',  (code) => {
            if(code)
              return reject(new Error('docker build failed'))
            if(this.closed) return reject(new Error('closed during startup'))
            console.log(['>docker', 'run', '-p', `${this.port}:8080`, '-t', id].concat(env_array).join(' '))
            this.proc = log(cp.spawn('docker', ['run', '-p', `${this.port}:8080`, '-t', id].concat(env_array)))
            setTimeout(resolve, 3000)
          })
        })
      })
    })
  }

  request (id, eventObject) {
    return fetch(`http://localhost:${this.port}/2015-03-31/functions/function/invocations`,
      {method: 'post', body: JSON.stringify(eventObject)}
    ).then(r => r.json())
  }

  close () {
    this.closed = true
    this.proc.kill(9)
  }
}

module.exports = DockerLambda