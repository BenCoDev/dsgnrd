# Project objective

This is a learning project to understand how agents cooperate by applying the approach of dust-tt/srchd to design collaboration.

# Architectural constraint

Preserve srchd's architecture. Do not redesign or replace its agent orchestration, collaboration mechanisms, or core system structure when adapting it to dsgnrd.

Adapt domain-specific problems, prompts, and content within that architecture. If a proposed change requires an architectural departure, explain it and ask Ben before implementing it.

After any code change that affects the data model, update the relevant README schema diagrams, their Mermaid sources and SVG exports in `docs/diagrams/`, and the accompanying descriptions in the same change; keep the srchd reference faithful to its cited upstream version.
