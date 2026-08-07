# Multi-Cloud Deployment Strategy (AWS + Azure)

Yes, it is absolutely possible to support both AWS and Azure seamlessly within the same repository. Since Visentra is already containerized (Docker) and uses standard protocols (PostgreSQL, Redis), the application code does not care which cloud it runs on. 

To achieve this without breaking the existing Azure workflow, we need to adapt the directory structure and deployment scripts to support multiple cloud providers.

Here is the architectural plan for how this will be structured and executed.

---

## 1. Directory Restructuring Plan

We will isolate the Infrastructure-as-Code (IaC) and the deployment bash scripts into provider-specific folders.

**Proposed Structure:**
```text
platform/
├── infra/
│   ├── azure/                 # Existing Bicep templates
│   ├── aws/                   # NEW: CloudFormation or Terraform templates for AWS
│   └── compose/               # Existing Docker Compose files (shared)
│
├── cloud-deploy/
│   ├── azure/                 # Move existing install.sh and teardown.sh here
│   └── aws/                   # NEW: install.sh for AWS
```

This ensures that customers using Azure just run `cloud-deploy/azure/install.sh`, and customers using AWS run `cloud-deploy/aws/install.sh`.

---

## 2. AWS Infrastructure Mapping

To mirror the enterprise-grade setup you currently have in Azure, here is how the AWS native services map to your architecture:

| Component | Current Azure Service | Proposed AWS Service |
| :--- | :--- | :--- |
| **Container Registry** | Azure Container Registry (ACR) | **Amazon ECR** (Elastic Container Registry) |
| **Relational Database** | Azure DB for PostgreSQL | **Amazon RDS for PostgreSQL** |
| **Secrets Management** | Azure Key Vault | **AWS Secrets Manager** |
| **Caching / PubSub** | Azure Container Apps Redis | **Amazon ElastiCache (Redis)** |
| **Compute (App Tier)** | Azure Container Apps | **Amazon EC2** (via UserData) OR **Amazon ECS** (Fargate) |

---

## 3. The AWS EC2 Deployment Flow (The `install.sh` Plan)

If a customer runs the new `platform/cloud-deploy/aws/install.sh`, the bash script will execute the following stages (very similar to the Azure script, but using the AWS CLI `aws` instead of `az`):

### Stage 1: AWS Foundation (Infrastructure)
The script uses AWS CloudFormation (or Terraform) located in `infra/aws/` to provision:
1. An **Amazon ECR** repository for your Docker images.
2. An **Amazon RDS** instance for PostgreSQL.
3. An **AWS Secrets Manager** vault to store the generated JWT secrets, Encryption Keys, and DB passwords.
4. An **Amazon EC2 Instance** (with an IAM Instance Profile that grants it permission to read from Secrets Manager and ECR).

### Stage 2: Local Docker Build & Push
Unlike Azure ACR Tasks (which build in the cloud), the AWS script will build the Docker images (`api`, `web`, `discovery`) locally or via a CI runner, tag them, and push them to the newly created Amazon ECR.
```bash
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ECR_URL
docker build -t $ECR_URL/agentradar-api:latest ../../apps/api
docker push $ECR_URL/agentradar-api:latest
```

### Stage 3: EC2 UserData Execution (The Handover)
When the EC2 instance boots up, it runs a "UserData" bash script. This script automatically:
1. Installs Docker and Docker Compose.
2. Authenticates with Amazon ECR and AWS Secrets Manager.
3. Downloads the `platform/infra/compose/docker-compose.prod.yml` file.
4. Injects the secrets (Postgres URL, JWT, etc.) into the environment.
5. Runs `docker compose up -d` to launch the API, Web, Discovery, and Neo4j containers on the EC2 host.

*(Note: If the customer wants serverless containers instead of EC2 virtual machines, we would use Amazon ECS with Fargate instead of EC2. ECS is the direct equivalent to Azure Container Apps).*

---

## 4. Execution Summary

**To make this a reality in the future, we would:**
1. Create `platform/infra/aws/main.yaml` (CloudFormation) to define the AWS network, RDS, and EC2 instance.
2. Create `platform/cloud-deploy/aws/install.sh` that wraps the `aws cli` commands.
3. Keep the application code (`apps/api`, `apps/web`) exactly as it is today. Because the apps read configuration from Environment Variables (`process.env.POSTGRES_URL`), they are completely cloud-agnostic.
