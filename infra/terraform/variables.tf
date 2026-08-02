variable "project_id" {
  description = "Google Cloud project that will host a future RightsRadar deployment."
  type        = string
}

variable "region" {
  description = "Default Google Cloud region for future infrastructure."
  type        = string
  default     = "us-central1"
}
