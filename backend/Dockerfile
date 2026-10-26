FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . .
RUN go mod tidy
RUN CGO_ENABLED=0 go build -trimpath -o /out/api .
RUN mkdir -p /out/uploads
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/api /api
COPY --from=build --chown=nonroot:nonroot /out/uploads /uploads
EXPOSE 8080
ENTRYPOINT ["/api"]
