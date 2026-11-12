build-DiligenceFunction:
	uv pip install -r requirements-lambda.txt --target "$(ARTIFACTS_DIR)" --python-platform x86_64-manylinux2014 --python-version 3.12 --only-binary :all:
	cp -r src/diligence "$(ARTIFACTS_DIR)/diligence"
	cp config.yaml "$(ARTIFACTS_DIR)/config.yaml"
	find "$(ARTIFACTS_DIR)" -name __pycache__ -type d -prune -exec rm -rf {} +
