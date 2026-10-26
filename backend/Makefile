GO_FILES := $(shell rg --files -g '*.go' -g '!vendor/**')

.PHONY: fmt format fmt-check format-check

fmt format:
	gofmt -w $(GO_FILES)

fmt-check format-check:
	@unformatted="$$(gofmt -l $(GO_FILES))"; \
	if [ -n "$$unformatted" ]; then \
		printf 'Go files need formatting:\n%s\n' "$$unformatted"; \
		exit 1; \
	fi
	@echo "All Go files are gofmt-formatted."
