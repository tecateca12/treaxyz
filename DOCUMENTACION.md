# TreaXYZ Bot — Documentación de flujos y reglas

Bot de reclamos por **WhatsApp** para sillones masajeadores LePark (y derivación de máquinas de entretenimiento). Incluye conversación con LLM, auditoría automática, evidencia pre-auditoría (fotos / comprobante), cola de pago y **panel admin** para tesorería.

---

## 1. Resumen del sistema

| Componente | Rol |
|------------|-----|
| **Meta WhatsApp** | Webhook de mensajes entrantes |
| **Flask API** | `app.py`, recursos REST y UI admin |
| **Flow** (`libs/flows/flows.py`) | Máquina de estados del reclamo y orquestación |
| **LLM (OpenAI)** | Diálogo (`resume_prompt`), auditoría (`audit_prompt`) |
| **PostgreSQL** | Clientes, reclamos, mensajes, auditorías, fotos |
| **Cloudinary** | Almacenamiento de fotos de evidencia |
| **Admin UI** | Listado, detalle y cierre manual (`COMPLETED` / `CANCELED`) |

---

## 2. Arquitectura

```mermaid
flowchart TB
    subgraph inbound [Entrada]
        WA[Webhook WhatsApp]
        Debounce[Debounce 3s]
        Parse[Parse texto / imagen / botones]
    end
    subgraph core [Núcleo]
        Flow[Flow.execute_flow]
        LLM[LLM diálogo]
        Audit[Auditor LLM]
        PG[(PostgreSQL)]
    end
    subgraph outbound [Salida]
        Send[send_message WhatsApp]
        Admin[Admin UI + API]
    end
    WA --> Debounce --> Parse --> Flow
    Flow --> LLM
    Flow --> PG
    Flow --> Audit
    Audit --> PG
    Flow --> Send
    Admin --> PG
```

**Archivos principales**

- Webhook: [`app_api/resources/whatsapp.py`](../app_api/resources/whatsapp.py), [`app_api/services/whatsapp.py`](../app_api/services/whatsapp.py)
- Flujo: [`libs/flows/flows.py`](../libs/flows/flows.py)
- Prompts: [`libs/llm/prompts/system_prompt.py`](../libs/llm/prompts/system_prompt.py)
- Catálogo: [`libs/machines/catalog.py`](../libs/machines/catalog.py)
- Admin: [`app_api/admin_ui.py`](../app_api/admin_ui.py), [`templates/admin/`](../templates/admin/)

---

## 3. Estados del reclamo (`claims.status`)

| Estado | Significado |
|--------|-------------|
| `PENDING` | Reclamo recién creado |
| `INFO_PENDING` | Faltan datos obligatorios o el auditor rechazó y hay que aportar más |
| `PENDING_CONFIRMATION` | Datos completos; el usuario debe confirmar el resumen |
| `AUDIT` | Transitorio: se está ejecutando la revisión automática en el mismo turno |
| `APPROVED` | Auditoría OK; se recolectan / confirman datos de reembolso |
| `READY_FOR_PAYOUT` | Reembolso validado; en cola para transferencia (tesorería) |
| `COMPLETED` | Transferencia registrada (solo admin / proceso interno) |
| `CANCELED` | Reclamo cancelado (usuario, entretenimiento, flood de rechazos, admin) |
| `CLOSED` | Legacy; se trata como inactivo en el flujo |

### Diagrama de transiciones (simplificado)

```mermaid
stateDiagram-v2
    direction TB
    [*] --> PENDING
    PENDING --> INFO_PENDING
    INFO_PENDING --> PENDING_CONFIRMATION: datos_completos
    PENDING_CONFIRMATION --> INFO_PENDING: usuario_corrige
    PENDING_CONFIRMATION --> Evidence: usuario_confirma
    state Evidence <<choice>>
    Evidence --> AUDIT: evidencia_OK
    AUDIT --> APPROVED: auditor_aprueba
    AUDIT --> INFO_PENDING: auditor_rechaza
    APPROVED --> READY_FOR_PAYOUT: reembolso_validado
    READY_FOR_PAYOUT --> COMPLETED: admin_aprueba_pago
    INFO_PENDING --> CANCELED
    PENDING --> CANCELED
    READY_FOR_PAYOUT --> CANCELED: admin_rechaza
```

**Quién puede cambiar cada transición**

| Transición | Chat (LLM + backend) | Admin API |
|------------|----------------------|-----------|
| Recolección → `PENDING_CONFIRMATION` | Sí (si datos obligatorios completos) | No |
| Confirmación → evidencia → `AUDIT` | Sí | No |
| `AUDIT` → `APPROVED` / vuelta a `INFO_PENDING` | Auditor automático | No |
| `APPROVED` → `READY_FOR_PAYOUT` | Usuario confirma reembolso | No |
| `READY_FOR_PAYOUT` → `COMPLETED` | No | **Sí** (única vía de “aprobar pago”) |
| Cualquier no-terminal → `CANCELED` | Usuario / reglas automáticas | **Sí** (con motivo) |
| `CANCELED` / `COMPLETED` → otro | No | No |

La sanitización de estados del diálogo está en `Flow._sanitize_status_from_dialogue` ([`libs/flows/flows.py`](../libs/flows/flows.py)): el modelo **no** puede fijar `APPROVED`, `COMPLETED`, `READY_FOR_PAYOUT` ni `REJECTED` como status del claim.

---

## 4. Sub-estados (`claims.step`)

| Step | Uso |
|------|-----|
| `START` | Por defecto |
| `AWAITING_CASH_EVIDENCE` | Esperando foto(s) del sillón (efectivo) |
| `AWAITING_TXN_EVIDENCE` | Esperando número de comprobante (digital) |
| `PAYOUT_CANCEL_CONFIRM` | Confirmación SI/NO para cancelar reclamo en cola de pago |

---

## 5. Flujo conversacional (WhatsApp)

1. **Usuario sin nombre** → `new_user_prompt`
2. **Usuario conocido sin reclamo activo** → `start_prompt`
3. **Reclamo activo** (no terminal, no `READY_FOR_PAYOUT`) → `resume_prompt` con `active_claim_info` + historial (`follow_up_summary` por mensaje)

**Debounce:** 3 segundos fijos por remitente antes de procesar el lote ([`WhatsappManager.background_process`](../app_api/services/whatsapp.py)). Texto e imágenes del burst se fusionan en `_merge_pending_batch` (incluye **caption** de imágenes).

**Tipos de mensaje:** texto, imagen (con caption), botones interactivos; audio y otros tipos se rechazan con mensaje fijo.

**Imagen fuera de paso de evidencia:** no se guarda; el texto del caption (si existe) se procesa con el LLM de diálogo y se aclara que la foto todavía no hace falta.

---

## 6. Datos obligatorios antes de confirmación

Función: `_claim_mandatory_complete_for_confirmation` ([`libs/flows/flows.py`](../libs/flows/flows.py)).

- Categoría: `sillones_masajeadores`
- Descripción (relato)
- Monto > 0
- Fecha del incidente
- Medio de pago (`payment_method_id`)
- Ubicación: `machine_location` (≥6 caracteres) **o** `location_extract` con ciudad + (nombre del lugar o keywords internos)

Cuando todo está completo, el chat pasa a `PENDING_CONFIRMATION` y pide confirmación explícita del resumen. Tras confirmar → colección de evidencia → `AUDIT`.

---

## 7. Efectivo vs pago digital

| `payment_method_id` | Medio | Evidencia pre-auditoría |
|---------------------|--------|-------------------------|
| 1 | Efectivo | ≥1 foto del sillón en `claim_evidence_photos` (máx. `CLAIM_EVIDENCE_MAX_PHOTOS`, default 3) |
| 2 | Mercado Pago | Número de comprobante en `transaction_receipt_number` (≥4 caracteres, alfanumérico) |
| 3 | MODO | Igual que digital |

**Reglas adicionales**

- Si el usuario cambia el medio de pago, se borran fotos y comprobante y se reinicia el step de evidencia.
- Fotos solo se aceptan en `AWAITING_CASH_EVIDENCE` con pago en efectivo.
- Comprobante solo en `AWAITING_TXN_EVIDENCE` con pago digital.

**Subida de fotos:** descarga desde Meta → Cloudinary (`claims/{id}/...`) → tabla `claim_evidence_photos`.

---

## 8. Auditoría automática

### Cuándo corre

- Tras evidencia completa: `status` → `AUDIT` y `_execute_audit_phase`.
- Re-auditoría desde `INFO_PENDING` si la última auditoría fue `REJECTED`, `PARSE_ERROR` o `UNEXPECTED_STATUS` y el usuario aporta lo pedido (`user_resubmits_for_audit`).

### UX de dos mensajes

1. **Inmediato:** acuse (“Recibí la foto…”, “Tu reclamo N°X ya está en revisión automática…”).
2. **Tras espera + LLM auditor:** resultado (aprobado / rechazo / datos de reembolso).

Configuración: `AUDIT_RESPONSE_DELAY_SECONDS` (default **60** s) entre el primer mensaje y la ejecución del auditor. Implementado con callback `on_user_message` en el `Flow` ([`app_api/services/whatsapp.py`](../app_api/services/whatsapp.py)).

### Qué valida el auditor (prompt)

- Coherencia del relato, ubicación vs catálogo `machines`
- Tarifas en `precios_tarifas` vs monto (digital más estricto)
- Medio de pago vs flags `efectivo` / `digital` de la fila
- `matched_machine_id` obligatorio si `APPROVED`

Catálogo: **todas** las filas de `machines` + índice de cobertura ([`build_audit_catalog_context`](../libs/machines/catalog.py)).

### Overrides en backend (después del LLM)

| Regla | Función | Condición |
|-------|---------|-----------|
| Tope efectivo | `_maybe_override_audit_for_cash_cap` | `APPROVED` + efectivo + monto > `CLAIM_CASH_MAX_TARIFF_MULTIPLIER` × mayor tarifa (default **3×**) |
| Monto vs duración digital | `_maybe_override_audit_for_digital_duration_mismatch` | Relato “en vez de N min” + monto no calza con paquete de N min en cartelera ([`catalog.py`](../libs/machines/catalog.py)) |

### Resultados y persistencia

- Tabla `claim_audits`: `outcome`, `reason`, `feedback_to_user`, `llm_decision`, etc.
- `REJECTED` → claim vuelve a `INFO_PENDING` con texto para el usuario.
- Más de `MAX_AUDIT_REJECTIONS_BEFORE_CANCEL` rechazos (default 3, cancela en el **4.º**) → `CANCELED` + mail de contacto.

### Limitaciones conocidas

- El auditor **no recibe** URLs de fotos ni el número de comprobante en el prompt; la evidencia es solo **requisito previo** (gate).
- `catalog_match` / `OVERRIDDEN_CATALOG` no se persisten hoy.
- `build_machines_catalog_text` (catálogo filtrado) existe pero el audit usa siempre el catálogo completo.

---

## 9. Catálogo y matching de máquinas

- Datos semilla: [`utils/machines/machines.json`](../utils/machines/machines.json) (migración Alembic).
- El auditor elige `matched_machine_id` = `id` de una fila del listado.
- Muchas filas tienen `city` NULL: matching por `interno`, `lugar`, `empresa`.
- Tras `APPROVED`, el backend guarda `claims.matched_machine_id`.

---

## 10. Tiempos y parámetros de UX

| Parámetro | Variable | Default | Efecto |
|-----------|----------|---------|--------|
| Debounce mensajes | *(hardcoded)* | 3 s | Agrupa ráfagas de WhatsApp |
| Espera pre-auditoría | `AUDIT_RESPONSE_DELAY_SECONDS` | 60 s | Pausa entre acuse y resultado del auditor |
| ETA cola de pago | `PAYOUT_ETA_HOURS` | 72 h | Texto al usuario en `READY_FOR_PAYOUT` |
| Máx. fotos evidencia | `CLAIM_EVIDENCE_MAX_PHOTOS` | 3 | Tope por reclamo en efectivo |
| Multiplicador tope efectivo | `CLAIM_CASH_MAX_TARIFF_MULTIPLIER` | 3.0 | Override backend post-audit |
| Rechazos antes de cancelar | `MAX_AUDIT_REJECTIONS_BEFORE_CANCEL` | 3 | Cuenta auditorías `REJECTED` |

**Gunicorn:** timeout 120 s en [`Procfile`](../Procfile) (auditoría + delay pueden ocupar el worker).

---

## 11. Reembolso y pago

1. Tras auditoría: `APPROVED` → el bot pide nombre, DNI, CBU/alias, email.
2. Usuario confirma → `refund_info.is_validated = true` → `READY_FOR_PAYOUT`.
3. Tesorería marca transferencia hecha vía admin → `COMPLETED`.

El chat **no** pasa a `COMPLETED` solo; tampoco permite abrir otro reclamo mientras hay uno en `READY_FOR_PAYOUT` (respuesta determinística sin LLM).

---

## 12. Panel Admin UI

| Ruta | Descripción |
|------|-------------|
| `/admin/login` | Contraseña → token Bearer en `sessionStorage` |
| `/admin/reports` | Listado con filtros por estado (etiquetas en español) |
| `/admin/reports/{id}` | Detalle: reclamo, cliente, reembolso, máquina, comprobante, fotos, mensajes, auditorías |

**Revisión manual** (sección oculta si el estado es `CANCELED` o `COMPLETED`):

- **Rechazar** (`CANCELED`): disponible en cualquier estado no terminal; motivo obligatorio.
- **Aprobar pago** (`COMPLETED`): solo si el estado actual es `READY_FOR_PAYOUT`.

API: `POST /reports/update_status` con Bearer `ADMIN_API_TOKEN`. Validación en [`utils/postgres_manager.py`](../utils/postgres_manager.py).

---

## 13. API de reportes (REST)

| Método | Ruta | Auth |
|--------|------|------|
| GET | `/reports/payment_pending` | Bearer |
| GET | `/reports/all` | Bearer |
| GET | `/reports/claims?status=` | Bearer |
| GET | `/reports/claims/{id}` | Bearer |
| POST | `/reports/update_status` | Bearer |

Swagger: `/docs`

---

## 14. Variables de entorno

Ver [`.env.example`](../.env.example). Destacadas:

- **OpenAI:** `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_RESUME_MODEL`, `OPENAI_AUDIT_MODEL`
- **Postgres:** `PG_*` o `DATABASE_URL`
- **WhatsApp:** `VERIFY_TOKEN`, `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID`
- **Cloudinary:** `CLOUDINARY_*`
- **Admin:** `SECRET_KEY`, `ADMIN_API_TOKEN`, `ADMIN_PASSWORD`
- **Negocio:** `AUDIT_RESPONSE_DELAY_SECONDS`, `PAYOUT_ETA_HOURS`, `CLAIM_EVIDENCE_MAX_PHOTOS`, `CLAIM_CASH_MAX_TARIFF_MULTIPLIER`, `MAX_AUDIT_REJECTIONS_BEFORE_CANCEL`, `ENTERTAINMENT_CLAIMS_EMAIL`
- **Tests:** `TEST_DATABASE_URL` (Postgres dedicado; ver sección 16)

---

## 15. Alcance de entrega y demora adicional

El alcance inicial del bot cubría conversación, recolección de datos y auditoría LLM por WhatsApp. **No estaban previstos** en la primera estimación:

1. **Panel Admin UI** — listado de reclamos, detalle, filtros por estado, flujo de aprobación de transferencia (`COMPLETED`) y rechazo con motivo (`CANCELED`), interfaz en español.
2. **Gestión de imágenes y evidencia** — integración Cloudinary, tabla `claim_evidence_photos`, comprobante digital, merge de captions en debounce, imágenes no solicitadas con procesamiento de texto adjunto, mensajes de auditoría en **dos tramos** con delay configurable.

Estas piezas sumaron diseño, implementación, pruebas manuales y correcciones de borde (mensajes juntos, captions perdidos, permisos de admin). Por eso la entrega final se extendió respecto del cronograma original del solo flujo conversacional.

---

## 16. Tests automatizados

```bash
pip install -r requirements.txt -r requirements-dev.txt

# Solo unitarios (sin Postgres)
pytest -m unit

# Integración (requiere TEST_DATABASE_URL)
export TEST_DATABASE_URL=postgresql+psycopg2://user:pass@localhost:5432/treaxyz_test
pytest -m integration
```

| Carpeta | Contenido |
|---------|-----------|
| `tests/unit/` | Catálogo, merge WhatsApp, evidencia, estados, overrides de auditoría |
| `tests/integration/` | `update_claim_status`, API de reportes con Flask test client |

---

## 17. Healthcheck

`GET /healthcheck/db` ejecuta `SELECT 1` contra Postgres. Devuelve 503 si la base no responde.

---

## Referencia rápida de archivos

```
libs/flows/flows.py          # Máquina de estados principal
libs/llm/prompts/            # Prompts y reglas del LLM
libs/machines/catalog.py     # Tarifas, catálogo, overrides digital
app_api/services/whatsapp.py # Webhook, debounce, envío
app_api/services/reports.py  # Mapeo admin
utils/postgres_manager.py    # Persistencia y update admin
templates/admin/             # UI HTML
static/admin/                # JS admin
tests/                       # pytest unit + integration
```
