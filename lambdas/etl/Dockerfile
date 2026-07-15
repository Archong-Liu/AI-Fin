# YMINSIGHT ETL Lambda — container image
# pandas + numpy + pyarrow exceed the 250MB zip limit, so we ship a container image.
FROM public.ecr.aws/lambda/python:3.12

# Install Python dependencies into the Lambda task root
COPY requirements.txt ${LAMBDA_TASK_ROOT}/
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt

# Copy handler code
COPY handler.py ${LAMBDA_TASK_ROOT}/

# Lambda entry point: <module>.<function>
CMD ["handler.lambda_handler"]
