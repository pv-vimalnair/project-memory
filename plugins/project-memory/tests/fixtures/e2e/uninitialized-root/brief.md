schema_version: "1.0.0"
name: "LifeOf Sample"
mission: "Help people follow through on meaningful habits."
namespace: "lifeof.sample"
root_kind: "product"
primary_archetype: "application-service"
blueprint: "application.consumer-mobile"
lifecycle: "prototype"
owners:
  - "Pitaji"
runtime_adapters:
  - "adapter.flutter"
workflow_adapters:
  - "adapter.github-ci"
success_criteria:
  - "The initialized memory is deterministic and reviewable."
included_scope:
  - "The product application and its governed delivery work."
excluded_scope:
  - "Unapproved external products."
