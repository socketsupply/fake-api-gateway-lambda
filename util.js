function invokeUnref (arg) {
  const obj = /** @type {Unrefable | null | { unref: unknown }} */ (arg)
  if (obj && obj.unref && typeof obj.unref === 'function') {
    obj.unref()
  }
  return arg
}

function maybePipe(source, dest) {
  if(source) {
    invokeUnref(source)
    source.pipe(dest, {end:false})
  }
}

exports.pipeStdio = function (proc, stdio) {
  maybePipe(proc.stdout, stdio.stdout || process.stdout)  
  maybePipe(proc.stderr, stdio.stderr || process.stderr)  
}
exports.invokeUnref = invokeUnref