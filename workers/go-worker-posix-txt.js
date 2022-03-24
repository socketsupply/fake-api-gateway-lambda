module.exports = /*go*/`
// Copyright 2017 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// Copyright https://github.com/yogeshlonkar/aws-lambda-go-test
package main

import (
  "bufio"
	"context"
  "encoding/json"
  "errors"
  "flag"
  "fmt"
  "log"
  "net"
  "net/rpc"
  "os"
  "os/exec"
  "path"
  "strconv"
  "syscall"
  "time"
)

type PingRequest struct { }
type PingResponse struct { }

//nolint:stylecheck
type InvokeRequest_Timestamp struct {
	Seconds int64
	Nanos   int64
}

//nolint:stylecheck
type InvokeRequest struct {
	Payload               []byte
	RequestId             string //nolint:stylecheck
	XAmznTraceId          string
	Deadline              InvokeRequest_Timestamp
	InvokedFunctionArn    string
	CognitoIdentityId     string //nolint:stylecheck
	CognitoIdentityPoolId string //nolint:stylecheck
	ClientContext         []byte
}

type InvokeResponse struct {
	Payload []byte
	Error   *InvokeResponse_Error
}

//nolint:stylecheck
type InvokeResponse_Error struct {
	Message    string                             \`json:"errorMessage"\`
	Type       string                             \`json:"errorType"\`
	StackTrace []*InvokeResponse_Error_StackFrame \`json:"stackTrace,omitempty"\`
	ShouldExit bool                               \`json:"-"\`
}

func (e InvokeResponse_Error) Error() string {
	return fmt.Sprintf("%#v", e)
}

//nolint:stylecheck
type InvokeResponse_Error_StackFrame struct {
	Path  string \`json:"path"\`
	Line  int32  \`json:"line"\`
	Label string \`json:"label"\`
}

const functioninvokeRPC = "Function.Invoke"

type Input struct {
  Delay         time.Duration
  TimeOut       time.Duration
  Port          int
  AbsLambdaPath string
  Payload       interface{}
  ClientContext *ClientContext
  Deadline      *InvokeRequest_Timestamp
}

// LogGroupName is the name of the log group that contains the log streams of the current Lambda Function
var LogGroupName string

// LogStreamName name of the log stream that the current Lambda Function's logs will be sent to
var LogStreamName string

// FunctionName the name of the current Lambda Function
var FunctionName string

// MemoryLimitInMB is the configured memory limit for the current instance of the Lambda Function
var MemoryLimitInMB int

// FunctionVersion is the published version of the current instance of the Lambda Function
var FunctionVersion string

func init() {
	LogGroupName = os.Getenv("AWS_LAMBDA_LOG_GROUP_NAME")
	LogStreamName = os.Getenv("AWS_LAMBDA_LOG_STREAM_NAME")
	FunctionName = os.Getenv("AWS_LAMBDA_FUNCTION_NAME")
	if limit, err := strconv.Atoi(os.Getenv("AWS_LAMBDA_FUNCTION_MEMORY_SIZE")); err != nil {
		MemoryLimitInMB = 0
	} else {
		MemoryLimitInMB = limit
	}
	FunctionVersion = os.Getenv("AWS_LAMBDA_FUNCTION_VERSION")
}

// ClientApplication is metadata about the calling application.
type ClientApplication struct {
	InstallationID string \`json:"installation_id"\`
	AppTitle       string \`json:"app_title"\`
	AppVersionCode string \`json:"app_version_code"\`
	AppPackageName string \`json:"app_package_name"\`
}

// ClientContext is information about the client application passed by the calling application.
type ClientContext struct {
	Client ClientApplication
	Env    map[string]string \`json:"env"\`
	Custom map[string]string \`json:"custom"\`
}

// CognitoIdentity is the cognito identity used by the calling application.
type CognitoIdentity struct {
	CognitoIdentityID     string
	CognitoIdentityPoolID string
}

// LambdaContext is the set of metadata that is passed for every Invoke.
type LambdaContext struct {
	AwsRequestID       string //nolint: stylecheck
	InvokedFunctionArn string //nolint: stylecheck
	Identity           CognitoIdentity
	ClientContext      ClientContext
}

// An unexported type to be used as the key for types in this package.
// This prevents collisions with keys defined in other packages.
type key struct{}

// The key for a LambdaContext in Contexts.
// Users of this package must use lambdacontext.NewContext and lambdacontext.FromContext
// instead of using this key directly.
var contextKey = &key{}

// NewContext returns a new Context that carries value lc.
func NewContext(parent context.Context, lc *LambdaContext) context.Context {
	return context.WithValue(parent, contextKey, lc)
}

// FromContext returns the LambdaContext value stored in ctx, if any.
func FromContext(ctx context.Context) (*LambdaContext, bool) {
	lc, ok := ctx.Value(contextKey).(*LambdaContext)
	return lc, ok
}

//Run a Go based lambda, passing the configured payload
//note that 'payload' can be anything that can be encoded by encoding/json
func Run(input Input) ([]byte, error) {
  input.setTimeOutIfZero()
  input.assignPortIfZero()
  tempExecution := input.startLambdaIfNotRunning()
  if tempExecution != nil {
    defer tempExecution()
  }
  if input.Delay != 0 {
    time.Sleep(input.Delay)
  }

  request, err := createInvokeRequest(input)
  if err != nil {
    return nil, err
  }

  // 2. Open a TCP connection to the lambda
  client, err := rpc.Dial("tcp", fmt.Sprintf(":%d", input.Port))
  if err != nil {
    return nil, err
  }

  // 3. Issue an RPC request for the Function.Invoke method
  var response InvokeResponse

  if err = client.Call(functioninvokeRPC, request, &response); err != nil {
    return nil, err
  }

  if response.Error != nil {
    return nil, errors.New(response.Error.Message)
  }

  return response.Payload, nil
}

func (input *Input) startLambdaIfNotRunning() func() {
  conn, err := net.DialTimeout("tcp", net.JoinHostPort("", strconv.Itoa(input.Port)), input.TimeOut)
  if err != nil {
    connectionRefused := false
    switch t := err.(type) {
    case *net.OpError:
      if t.Op == "dial" || t.Op == "read" {
        connectionRefused = true
      }
    case syscall.Errno:
      if t == syscall.ECONNREFUSED {
        connectionRefused = true
      }
    }
    if connectionRefused {
      // run function if no service running on given port
      if input.AbsLambdaPath == "" {
        input.AbsLambdaPath = "main.go"
      }

      if err := os.Chdir(path.Dir(input.AbsLambdaPath)); err != nil {
        log.Fatal("failed to change directory to lambda project: ", err)
      }

      cmd := exec.Command("go", "run", input.AbsLambdaPath)
      cmd.Env = append(
        os.Environ(),
        fmt.Sprintf("_LAMBDA_SERVER_PORT=%d", input.Port),
      )

      cmd.SysProcAttr = &syscall.SysProcAttr {
        Pdeathsig: syscall.SIGTERM,
        Setpgid: true,
      }

      cmd.Stderr = os.Stderr
      cmd.Stdout = os.Stdout
      cmd.Stdin = os.Stdin

      if err := cmd.Start(); err != nil {
        log.Fatal(err)
      }

      time.Sleep(2 * time.Second)
      return func() {
        syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
      }
    } else {
      panic(err)
    }
  }
  if conn != nil {
    conn.Close()
  }
  return nil
}

// set default timeout to 2 seconds as the connection is
// expected to be local
func (input *Input) setTimeOutIfZero() {
  input.TimeOut = time.Second * 2
}

func (input *Input) assignPortIfZero() {
  if input.Port == 0 {
    listener, err := net.Listen("tcp", ":0")
    if err != nil {
      panic(err)
    }
    defer listener.Close()
    input.Port = listener.Addr().(*net.TCPAddr).Port
  }
}

func createInvokeRequest(input Input) (*InvokeRequest, error) {
  payloadEncoded, err := json.Marshal(input.Payload)
  if err != nil {
    return nil, err
  }

  var clientContextEncoded []byte
  if input.ClientContext != nil {
    b, err := json.Marshal(input.ClientContext)

    if err != nil {
      return nil, err
    }

    clientContextEncoded = b
  }

  Deadline := input.Deadline

  if Deadline == nil {
    t := time.Now()
    Deadline = &InvokeRequest_Timestamp{
      Seconds: int64(t.Unix()),
      Nanos:   int64(t.Nanosecond()),
    }
  }

  return &InvokeRequest{
    Payload:               payloadEncoded,
    RequestId:             "0",
    XAmznTraceId:          "",
    Deadline:              *Deadline,
    InvokedFunctionArn:    "",
    CognitoIdentityId:     "",
    CognitoIdentityPoolId: "",
    ClientContext:         clientContextEncoded,
  }, nil
}

type Result struct {
  IsBase64Encoded bool \`json:"isBase64Encoded"\`
  StatusCode int \`json:"statusCode"\`
  Headers map[string]string \`json:"headers"\`
  Body string \`json:"body"\`
}

type ResultObject struct {
  Message string \`json:"message"\`
  Id string  \`json:"id"\`
  Result Result \`json:"result"\`
}

type Event struct {
  Id string
  EventObject json.RawMessage
}

func main () {
  portFlag := flag.Int("p", 8888, "Port to run lambda on")
  pathFlag := flag.String("P", "", "Path to lambda file")

  flag.Parse()

  var lambdaPort = *portFlag
  var lambdaPath = *pathFlag

  stat, _ := os.Stdin.Stat()

  var event = Event { Id: "0" }

  if (stat.Mode() & os.ModeCharDevice) == 0 {
    reader := bufio.NewReader(os.Stdin)
    line, _ := reader.ReadString('\\n')

    json.Unmarshal([]byte(line), &event)
  }

  res, err := Run(Input {
    Port: lambdaPort,
    Payload: event.EventObject,
    AbsLambdaPath: lambdaPath,
  })

  if err != nil {
    log.Fatal(err)
  }

  var result = Result {
    Headers: map[string]string{},
  }

  json.Unmarshal(res, &result)

  if err != nil {
    log.Fatal(err)
  }

  encoded, err := json.Marshal(&ResultObject {
    Id: event.Id,
    Message: "result",
    Result: result,
  })

  if err != nil {
    log.Fatal(err)
  }

  fmt.Printf("__FAKE_LAMBDA_START__%s__FAKE_LAMBDA_END__\\n", encoded)
}
`
