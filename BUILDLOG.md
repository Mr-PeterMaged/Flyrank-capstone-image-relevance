# Build log

## Design
- The user requested the AI Image Understanding & Content Matching capstone as a new task.
- AI read the PDF, searched the existing workspace, and drafted this independent project.
- Node.js matches the earlier backend tasks; PostgreSQL provides real transactional persistence and worker coordination.
- No private internship dataset or credentials were printed or copied. Provider selection and the new public repository URL were requested from the user.
- Model quality and eval precision are not yet claimed. Mock tests will be clearly distinguished from a real-model evaluation.

## Implementation and initial validation
- Implemented PostgreSQL migrations, authenticated uploads, stored metadata/tags/vectors, leased background processing, atomic per-call budget reservations, explained guard decisions, and persistent human review.
- The deterministic integration suite passed 15 tests using actual HTTP and PostgreSQL with injected synthetic model responses. Chromium passed 3 UI scenarios. These results establish application behavior, not model quality.
- Collected a manifest of 40 licensed Wikimedia Commons images covering animal, food, landscape and vehicle content. Search groups are collection hints, never labels passed to inference. Some sources are artwork or difficult distractors, so the collection is described as images, not exclusively photographs.
- Inspected a contact sheet and wrote 6 calibration and 12 held-out article labels before running the final vision model. These are AI-assisted manual labels, not claimed to be independently human-reviewed.
- The initial Moondream pilot timed out once and then returned a short caption with 0.5 confidence. The system correctly flagged it. Switched the default model to Qwen3-VL 2B and retained the failed pilot's usage records; results are not silently replaced with fixtures.
- npm audit identified known vulnerabilities in the initially selected sharp release. Upgraded to 0.35.4; the subsequent audit reported zero known vulnerabilities.
