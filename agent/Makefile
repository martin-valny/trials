build-DiligenceFunction:
	python3 -m pip install -r requirements-lambda.txt -t "$(ARTIFACTS_DIR)" --platform manylinux2014_x86_64 --only-binary=:all: --python-version 3.12 --implementation cp --upgrade
	cp -r src/diligence "$(ARTIFACTS_DIR)/diligence"
	cp config.yaml "$(ARTIFACTS_DIR)/config.yaml"
	find "$(ARTIFACTS_DIR)" -name __pycache__ -type d -prune -exec rm -rf {} +
