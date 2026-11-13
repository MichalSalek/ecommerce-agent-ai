# Next portfolio projects - proposals only

No new product or home-site integration was implemented in this session. Public employer examples checked on 2026-11-13 are signals, not a representative labor-market study or a guarantee of an interview.

## Recommended first: evidence-based document intake

Python / FastAPI / Pydantic / React / PostgreSQL. Upload a small sample supplier document, extract a typed record through Groq, show field evidence, require approval before a database write, and support retry/idempotency. Queue slow work with a small worker; add OpenTelemetry traces, fixtures/evaluations and Docker Compose. Avoid real personal documents in the public demo. This is distinct from a generic chat: it demonstrates a workflow, typed contracts, background work and measured extraction quality.

MVP: one document type, status timeline, strict output schema, 20 evaluation fixtures, human review, audited/idempotent save. Leave OCR/model fine-tuning outside the first version.

## Java option: support-case copilot

Java 21 / Spring Boot / Spring Security / PostgreSQL / React TypeScript, JUnit and Testcontainers. The model suggests a ticket category, priority and draft response using a small approved knowledge set. Rules and a human approve side effects; model access is behind a provider port. Use an outbox plus one event consumer to demonstrate idempotency and retry; Kafka can be an optional Compose profile when the event boundary actually helps, rather than five artificial microservices.

MVP: cases, typed model recommendation, approval, immutable audit trail, one asynchronous event, integration tests and a visible trace. Do not let the LLM set access permissions or send customer emails automatically.

## Agent-automation option: change-request planner

Python/FastAPI or Spring Boot with React: a user describes an operational change, the assistant creates a constrained plan from allowlisted tools, shows dry-run impact and requires approval. Execute against a fake business API. Include timeout, retry/backoff, idempotency key, cancellation and replayable events. This provides a clear demonstration of the difference between planning and executing side effects.

## Why these technologies

- [Capgemini Fullstack Gen AI Developer](https://careers.capgemini.com/job/Warszawa-Fullstack-Gen-AI-Developer/1263377701/) explicitly asks for Python, React/Next.js, FastAPI/Node, RAG, APIs and cloud/CI/CD.
- [Capgemini Backend Engineer (Python, AI)](https://careers.capgemini.com/job/Warszawa-Backend-Engineer-%28Python%2C-AI%29/1435777633/) highlights FastAPI, REST and AI-powered service integration.
- [EPAM Senior Full-Stack Java/React](https://careers.epam.com/en/vacancy/senior-full-stack-engineer-java-and-react-blt93l81bllj4659v78_en) names Java/Spring Boot, React, PostgreSQL/Kafka and JUnit/Testcontainers.

These examples support a portfolio direction, not building every listed technology at once. Prefer one coherent project with acceptance/evaluation evidence over a collection of thin chatbot wrappers. Groq 120B can interpret/extract/plan; smaller chat models can be evaluated against the same fixtures for latency and correctness. Model names alone do not prove which one is best for the task.

## michalsalek.com hero assistant

The inspected site is a Next static export (`output: export`) with English/Polish content. It can remain statically hosted. A tiny separate server-side endpoint must proxy Groq, because a provider API secret cannot safely live in browser JavaScript. CORS only narrows browser origins; it is not authentication or an abuse-prevention boundary.

For a compact service catalog, start without a vector database or local encoder:

1. Maintain a reviewed public `services.md`/JSON knowledge pack with service IDs, scope, public examples, constraints and canonical links. Source it from actual current site content; keep private project notes/contracts out.
2. Deploy a small API or serverless function that loads that versioned pack, includes it in the prompt, bounds history/input/output, validates citations against allowlisted service IDs and calls Groq.
3. Render a focused hero interaction with starter questions such as “Which service fits this workflow?” or “What can you automate?” and links to actual pages. Preserve ordinary navigation and accessible content/SEO.
4. Require explicit action to open a contact link. Do not invent quotes, delivery dates, client references or availability. Add request/cost limits and no raw conversation logging by default.
5. Evaluate a small question set in PL/EN and unknown-answer cases. Move to lexical retrieval or RAG only if the knowledge pack grows enough that prompt size, freshness or relevance becomes a measured problem.

Architecture: static page -> separate protected/rate-limited chat API -> public Markdown/JSON knowledge pack + Groq -> grounded response/service links. The site remains a static frontend; the feature as a whole has a backend. A small Node API could run on MyDevil without ONNX/LanceDB, or be a separately deployed serverless endpoint. Free-tier/cost/security acceptance must be checked for whichever host is chosen. Do not reuse the ecommerce public API without a separate application scope, prompt and quota boundary.

This is a knowledge-grounded assistant, not necessarily an autonomous agent. Start with conversation and service discovery; add real tools only when they solve an actual user action and have an explicit approval boundary.
