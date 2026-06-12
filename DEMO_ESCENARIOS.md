# Escenarios de demo — treaxyzBot

Guía para reproducir casos representativos por WhatsApp y validarlos en el panel admin (`/admin/reports/{id}`).

Ver también la documentación general en [`DOCUMENTACION.md`](DOCUMENTACION.md) (§7–§8, §12).

---

## Precondiciones

| Requisito | Detalle |
|-----------|---------|
| Catálogo | Máquinas reales en [`utils/machines/machines.json`](../utils/machines/machines.json). Abasto Shopping usa tarifas **$4.000 (5 min) / $8.000 (10 min) / $10.000 (12,5 min)**. |
| Evidencia efectivo | `payment_method_id = 1` → ≥1 foto del sillón en `claim_evidence_photos`. |
| Evidencia digital | MP (`id=2`) o MODO (`id=3`) → comprobante en texto, ≥4 caracteres en `transaction_receipt_number`. |
| Delay de auditoría | Para demo ágil: `AUDIT_RESPONSE_DELAY_SECONDS=0` (o valor bajo) en `.env`. |
| Variabilidad LLM | El auditor puede variar en detalle; los escenarios **2** y **4** tienen **overrides deterministas** en backend si el LLM devuelve `APPROVED`. |
| Admin | Login en `/admin/login`, detalle en `/admin/reports/{claim_id}`. |

### Qué mirar en la sección Auditorías (admin)

Cada corrida aparece como **Auditoría N de M** (orden cronológico: #1 = primera, #M = más reciente), con:

- **Resultado** (`outcome`): `APPROVED`, `REJECTED`, `PARSE_ERROR`, `UNEXPECTED_STATUS`
- **Decisión LLM** (`llm_decision`)
- **Motivo** (`reason`)
- **Feedback al usuario** (`feedback_to_user`)
- Nota de **override** si `llm_decision = APPROVED` y `outcome = REJECTED`

---

## Resumen de los 5 escenarios

| # | Nombre | Medio | Resultado audit | Estado claim (esperado) | Destaca en UI |
|---|--------|-------|-----------------|-------------------------|---------------|
| 1 | Efectivo aprobado estándar | Efectivo | `APPROVED` | `APPROVED` | 1 audit; fotos; máquina matcheada |
| 2 | Efectivo tope 3× (override) | Efectivo | `REJECTED` | `INFO_PENDING` | `TOPE_EFECTIVO`; nota override |
| 3 | Digital MP aprobado | Mercado Pago | `APPROVED` | `APPROVED` | Comprobante; sin fotos |
| 4 | Digital duración vs monto | MP/MODO | `REJECTED` | `INFO_PENDING` | `MONTO_VS_DURACION`; override |
| 5 | Re-auditoría (2 corridas) | Efectivo o digital | 1.º `REJECTED` → 2.º `APPROVED` | `APPROVED` | **Historial con 2+ audits** |

---

## Escenario 1 — Efectivo aprobado estándar

**Objetivo:** Flujo feliz en efectivo con una sola auditoría aprobada.

### Datos del reclamo

| Campo | Valor sugerido |
|-------|----------------|
| Ubicación | Abasto Shopping, sillón **Abasto 1 - Subsuelo (N00G047)** |
| Monto | **$8.000** (paquete 10 min, coherente con cartelera) |
| Medio de pago | Efectivo |
| Relato | "Ayer pagué $8000 en efectivo en el sillón del subsuelo del Abasto. Elegí 10 minutos pero se apagó a los 3." |
| Fecha | Ayer o fecha concreta |

### Mensajes sugeridos (WhatsApp)

1. Iniciar reclamo por sillón de masajes.
2. Aportar relato, monto, fecha, ubicación y confirmar que fue **en efectivo**.
3. Confirmar el resumen cuando el bot pase a `PENDING_CONFIRMATION`.
4. Enviar **1 foto** del sillón cuando lo pida.

### Resultado esperado

| Dónde | Qué esperar |
|-------|-------------|
| `claims.status` | `APPROVED` (luego el bot pide datos de reembolso) |
| `claim_audits` | 1 fila: `outcome = APPROVED`, `llm_decision = APPROVED` |
| Admin — Fotos | Al menos 1 foto visible |
| Admin — Máquina | `matched_machine_id` apuntando a fila Abasto Subsuelo |
| Admin — Auditorías | **Auditoría 1 de 1** con resultado APPROVED |

### Checklist demo

- [ ] Una sola auditoría en orden cronológico
- [ ] Motivo coherente con aprobación
- [ ] Fotos del sillón en la sección correspondiente

---

## Escenario 2 — Efectivo tope 3× (override backend)

**Objetivo:** Mostrar rechazo por regla de negocio post-LLM cuando el monto en efectivo supera 3× la mayor tarifa de la máquina.

### Regla en código

[`_maybe_override_audit_for_cash_cap`](../libs/flows/flows.py): si el LLM aprueba pero `amount > CLAIM_CASH_MAX_TARIFF_MULTIPLIER × max(tarifas)` (default **3×**), el backend fuerza `REJECTED`.

Con tarifas Abasto (máx. **$10.000**), el tope es **$30.000**. Monto **$35.000** dispara el override.

### Datos del reclamo

| Campo | Valor sugerido |
|-------|----------------|
| Ubicación | Abasto 1 - Subsuelo |
| Monto | **$35.000** |
| Medio de pago | Efectivo |
| Relato | "Pagué $35000 en efectivo en el sillón del subsuelo del Abasto y no funcionó." |

### Evidencia

1 foto del sillón (igual que escenario 1).

### Resultado esperado

| Dónde | Qué esperar |
|-------|-------------|
| `claims.status` | `INFO_PENDING` |
| `claim_audits` | 1 fila: `outcome = REJECTED`; `reason` contiene **`TOPE_EFECTIVO`** |
| `llm_decision` | Puede ser `APPROVED` si el LLM aprobó antes del override |
| Admin — Auditorías | Nota: *"El LLM aprobó; el backend aplicó una regla de negocio (override)."* |
| Feedback al usuario | Texto sobre tope de monto y mail de contacto |

### Checklist demo

- [ ] `outcome = REJECTED` con `llm_decision = APPROVED` (override visible)
- [ ] Motivo con prefijo `TOPE_EFECTIVO`
- [ ] Claim en `INFO_PENDING`, no cancelado

---

## Escenario 3 — Digital Mercado Pago aprobado

**Objetivo:** Flujo feliz con pago digital y comprobante (sin fotos).

### Datos del reclamo

| Campo | Valor sugerido |
|-------|----------------|
| Ubicación | Abasto Shopping, **Abasto 2 - Adidas (N02G010A)** |
| Monto | **$8.000** (10 min) |
| Medio de pago | Mercado Pago |
| Relato | "Ayer pagué con Mercado Pago $8000 en el sillón de Adidas del Abasto. Duró menos de lo que pagué." |
| Comprobante | `MP-1234567890` (≥4 caracteres) |

### Mensajes sugeridos

1. Completar datos obligatorios indicando **Mercado Pago**.
2. Confirmar resumen.
3. Cuando pida comprobante, enviar el número en un **mensaje de texto** (no foto).

### Resultado esperado

| Dónde | Qué esperar |
|-------|-------------|
| `claims.status` | `APPROVED` |
| `claim_audits` | 1 fila: `outcome = APPROVED` |
| Admin — Comprobante | Número visible en sección "Comprobante de transacción" |
| Admin — Fotos | "Sin fotos del sillón" |
| Admin — Auditorías | **Auditoría 1 de 1** APPROVED |

### Checklist demo

- [ ] Comprobante registrado, sin fotos
- [ ] Una auditoría aprobada
- [ ] Medio de pago "mercado_pago" (o equivalente en DB)

---

## Escenario 4 — Digital duración vs monto (override backend)

**Objetivo:** Rechazo por inconsistencia entre relato de duración y monto pagado (pago digital).

### Regla en código

[`_maybe_override_audit_for_digital_duration_mismatch`](../libs/flows/flows.py): si el relato menciona duración esperada (p. ej. *"en vez de 5 minutos"*) y el monto calza con **otro** paquete de la cartelera, el backend fuerza `REJECTED` aunque el LLM haya aprobado.

### Datos del reclamo

| Campo | Valor sugerido |
|-------|----------------|
| Ubicación | Abasto 3 - Cine |
| Monto | **$10.000** (paquete 12,5 min — no 5 min) |
| Medio de pago | Mercado Pago o MODO |
| Relato | "Pagué con QR en el sillón del cine del Abasto esperando **5 minutos** pero en vez de 5 minutos duró 2." |
| Comprobante | `MP-9876543210` |

### Resultado esperado

| Dónde | Qué esperar |
|-------|-------------|
| `claims.status` | `INFO_PENDING` |
| `claim_audits` | 1 fila: `outcome = REJECTED`; `reason` contiene **`MONTO_VS_DURACION`** |
| Admin — Auditorías | Override visible si `llm_decision = APPROVED` |
| Feedback al usuario | Pide aclarar monto vs tiempo elegido en pantalla |

### Checklist demo

- [ ] Motivo con `MONTO_VS_DURACION`
- [ ] Nota de override backend (si aplica)
- [ ] Comprobante presente, sin fotos

---

## Escenario 5 — Re-auditoría (historial con 2 corridas)

**Objetivo:** Validar que el admin muestra **todas** las auditorías en orden cuando hay re-intento tras rechazo.

### Regla en código

Tras `REJECTED`, `PARSE_ERROR` o `UNEXPECTED_STATUS`, el claim queda en `INFO_PENDING`. Si el usuario aporta lo pedido, el bot puede volver a `AUDIT` ([`_AUDIT_OUTCOMES_ALLOWING_RERUN`](../libs/flows/flows.py)).

### Fase 1 — Primera auditoría (rechazo esperado)

| Campo | Valor sugerido |
|-------|----------------|
| Ubicación | Vaga: *"un shopping en CABA"* (sin nombre de máquina ni lugar concreto) |
| Monto | $8.000 |
| Medio | Efectivo o Mercado Pago (según prefieras mostrar fotos o comprobante) |
| Evidencia | Foto o comprobante según medio |

**Resultado fase 1:** `REJECTED` → `INFO_PENDING`; feedback pidiendo ubicación exacta / máquina.

### Fase 2 — Corrección y re-auditoría

Responder con datos concretos, por ejemplo:

> "Fue en Abasto Shopping, sillón del subsuelo, Abasto 1."

Si el bot pide confirmación o más datos, completarlos. Tras nueva evidencia (si hace falta reconfirmar), segunda corrida del auditor.

**Resultado fase 2:** `APPROVED` → `APPROVED`.

### Resultado esperado en admin

| Dónde | Qué esperar |
|-------|-------------|
| `claim_audits` | **2 filas** (o más si hubo intentos extra) |
| Orden en UI | **Auditoría 1 de 2** = REJECTED (primera); **Auditoría 2 de 2** = APPROVED (última) |
| `claims.status` | `APPROVED` tras la segunda corrida |

### Checklist demo

- [ ] Dos bloques numerados en sección Auditorías
- [ ] Primera corrida REJECTED con feedback visible
- [ ] Segunda corrida APPROVED
- [ ] Orden cronológico claro (1 → 2)

---

## Escenario opcional (no incluido en los 5)

**READY_FOR_PAYOUT → COMPLETED:** útil si la demo también cubre tesorería: completar datos de reembolso tras escenario 1 o 3, llegar a `READY_FOR_PAYOUT` y usar **"Aprobar (marcar pago realizado)"** en revisión manual del admin. No agrega filas a `claim_audits`.

---

## Tips para la presentación

1. **Preparar números de WhatsApp distintos** (o limpiar claims entre escenarios) para no mezclar conversaciones.
2. **Anotar el `claim_id`** que muestra el bot al confirmar; es la URL del admin.
3. Para escenarios 2 y 4, **mencionar en voz alta** que el LLM pudo haber aprobado pero el backend aplicó la regla — la UI lo refleja.
4. El escenario 5 es el **más importante** para demostrar el historial completo de auditorías.
