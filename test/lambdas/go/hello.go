package main

import (
  "fmt"
  "context"

  "github.com/aws/aws-lambda-go/lambda"
)

type HelloResponse struct {
  StatusCode int `json:"statusCode"`
  Body string `json:"body"`
}

func RequestHandler (ctx context.Context) (HelloResponse, error) {
  return HelloResponse {
    StatusCode: 200,
    Body: "Hello from Lambda! (go)",
  }, nil
}

func main () {
  fmt.Println("hello from lambda")
  lambda.Start(RequestHandler)
}
