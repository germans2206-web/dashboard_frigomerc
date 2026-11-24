# Dashboard de consumo por planta

KPIs de **agua, energía y vapor** por planta frigorífica (2, 3, 8 y 23), comparables entre plantas y por período, leídos **en vivo** desde Google Sheets.

**Sitio:** https://consumo-plantas.germans2206.workers.dev

## Cómo funciona

```
Google Sheets (pestaña Kpis) ──► Cloudflare Worker /api/data ──► Dashboard (navegador)
                                 caché 5 min en el edge            se refresca cada 5 min
```

- `src/worker.js`: lee la pestaña **Kpis** exportada como CSV, la normaliza a JSON y la guarda 5 min en caché. Si Google falla, sirve la última copia válida y lo avisa con un banner. `?fresh=1` (el botón ⟳ del dashboard) fuerza la relectura.
- `src/index.html`: el dashboard (Chart.js). Toda la lógica de períodos y comparaciones corre en el navegador.

**Cualquier dato que se cargue o corrija en la planilla aparece en el dashboard en ≤ 5 minutos**, sin volver a desplegar. Con el botón ⟳ aparece al instante.

## Requisitos de la planilla

- Compartida como *Cualquier persona con el enlace → Lector*.
- Pestaña `Kpis` (gid `290742623`) con las columnas: `Fecha`, `CONSUMO AGUA M3`, `Consumo de energia beef`, `Consumo de energia Graseria`, `Consumo de vapor Beef`, `Consumo de vapor graseria`, `PLANTA`, `CABEZAS`, `Min parada faena`, `Horas trabajadas faena`, `Min parada despostada`, `Horas trabajadas despostada`. Las columnas se buscan por nombre, así que su orden puede cambiar.
- **Metas (opcional):** crear una pestaña `Metas` con las columnas `Planta | Agua m3/cab | Energia beef kWh/cab | Vapor beef kg/cab`. Si no existe, se usa la meta de la Planta 2 del HTML original (2,54 m³/cab · 82,08 kWh/cab · 48,6 kg/cab).

## Funcionalidades

- Filtros: agrupar por mes, trimestre, año o rango libre; comparar contra el período anterior o contra el mismo período del año anterior; elegir plantas (doble clic para ver una sola).
- Si el período está en curso, se compara contra la misma cantidad de días.
- KPIs consolidados: agua, energía y vapor beef por cabeza, cabezas faenadas, y energía y vapor de grasería.
- Comparativo entre plantas (barras: actual vs. comparación) y evolución mensual con la línea de meta.
- Matriz de KPIs por planta, por cabeza o en totales, con variación %, ★ a la mejor intensidad y cumplimiento de metas.
- Detalle diario (o semanal en períodos largos).
- Operación: cabezas por día, cabezas por hora y minutos de parada.
- Calidad de datos:
  - último día cargado y cobertura por planta;
  - aviso cuando faltan cabezas;
  - **valores atípicos** (más de 8× la mediana de la planta) que se excluyen y se listan para corregirlos en la planilla;
  - fechas inválidas que se ignoran.
- La vista se puede compartir: los filtros quedan en la URL (`#g=q&c=yoy&...`).
- Tema claro/oscuro, diseño adaptable a móvil.

**Definición de intensidad:** el consumo de los días con faena dividido por las cabezas faenadas esos mismos días. La Planta 8 no faena, así que solo muestra totales.

## Desarrollo y despliegue

```bash
npm install
npx wrangler dev      # local en http://localhost:8787
npx wrangler deploy   # publica en Cloudflare
```

Para que cada push a `main` despliegue solo, hay dos caminos:

1. **Workers Builds (recomendado):** en Cloudflare, ir a *Workers & Pages → consumo-plantas → Settings → Builds → Connect* y elegir este repositorio.
2. **GitHub Actions:** cargar en el repositorio los secrets `CLOUDFLARE_API_TOKEN` (plantilla "Edit Cloudflare Workers") y `CLOUDFLARE_ACCOUNT_ID`, y la variable `CF_DEPLOY_ENABLED=true`. El workflow está en `.github/workflows/deploy.yml`.

El ID de la planilla no se guarda en este repositorio (es público). Antes de desplegar, pega el ID en `SHEET_ID` dentro de `wrangler.jsonc`. El Worker publicado ya lo tiene configurado como variable en Cloudflare.
