FROM python:3.12-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN pip install --no-cache-dir "uv>=0.7,<1"
COPY pyproject.toml uv.lock ./
COPY services/api/pyproject.toml ./services/api/pyproject.toml
COPY services/api/app ./services/api/app
RUN uv sync --locked --directory services/api --no-dev --group cloud

ENV PATH="/app/.venv/bin:${PATH}"
WORKDIR /app/services/api
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
