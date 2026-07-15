# YMINSIGHT Inference Lambda — container image
# Build context MUST be the repo root so we can copy ml/training/ (the HybridModel
# class definition needed to unpickle model.joblib) alongside the handler.
#
#   docker build -f lambdas/inference/Dockerfile -t yminsight-inference .
#
# Python 3.13 base matches the training environment (issue #4 requirements.txt).
FROM public.ecr.aws/lambda/python:3.13

# Install pinned dependencies (must match the training env for pickle compatibility)
COPY lambdas/inference/requirements.txt ${LAMBDA_TASK_ROOT}/
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt

# Bake in the ML training package (for unpickling HybridModel) + the ISO 19030
# speed-loss module (compute() is import-light: numpy/pandas only).
COPY ml/training/ ${LAMBDA_TASK_ROOT}/ml/training/
COPY ml/speed_loss.py ${LAMBDA_TASK_ROOT}/ml/speed_loss.py
RUN touch ${LAMBDA_TASK_ROOT}/ml/__init__.py

# Handler code
COPY lambdas/inference/handler.py ${LAMBDA_TASK_ROOT}/

CMD ["handler.lambda_handler"]
