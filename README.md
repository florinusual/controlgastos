# Control de gastos

App web instalable (PWA) para llevar tus tarjetas de crédito, lo que separas en cada quincena, tus movimientos y la lista del súper. Mismo formato que el Diario de Lectura, en negro, verde bandera y verde pasto. Los datos se guardan en **Firebase** (Firestore) con inicio de sesión de Google.

## Secciones

### Tarjetas
- Registras cada tarjeta: nombre, día de corte, día límite de pago, deuda actual y el mes del primer corte.
- En cada corte capturas el **pago del corte** y escribes a mano lo que separas en cada una de las **dos quincenas** (no se calcula ni se ajusta solo).
- Marcas la 1ª y 2ª quincena como separadas (queda la fecha), **Ya pagué la tarjeta**, la **fecha real de pago** y el **monto pagado**. Si pagas después de la fecha límite se marca el atraso en días.
- **Deuda final = deuda actual − monto pagado.** El mes siguiente, **deuda actual = deuda final anterior + intereses / cargos**.
- Historial por tarjeta.
- Cada tarjeta muestra las compras que anotaste con ella en **Movimientos** durante ese corte.

### Quincenas
Para cada día de pago (14 y penúltimo día del mes) muestra cuánto separar en total y de qué tarjetas, con sus checks.

### Movimientos (de la Libreta de bolsillo)
Salidas y entradas con monto, concepto, de dónde lo pagaste (efectivo, débito o una de tus tarjetas), fecha y hora. Los marcas cuando ya los pasaste a tu libreta y se van a **Flujos pasados**. Al marcar una tarjeta como pagada puedes anotar el pago como salida con un toque.

### Súper (de la Libreta de bolsillo)
Lista de lo que se te acabó por tienda (Walmart, Aurrera, 3B, Supercito, Otros). Al terminar, **Ya pagué** abre Movimientos con el concepto listo.

## Configurar Firebase (proyecto nuevo)

1. En <https://console.firebase.google.com> crea un proyecto (por ejemplo `control-gastos`).
2. **Authentication → Método de acceso:** habilita **Google**.
3. **Firestore Database:** crea la base en modo producción.
4. **Configuración del proyecto → Tus apps:** agrega una app **Web** y copia `firebaseConfig` en `js/firebase-config.js`.
5. **Firestore → Reglas:** pega el contenido de `firestore.rules` y publica.
6. **Authentication → Configuración → Dominios autorizados:** agrega `florinusual.github.io`.

Mientras `js/firebase-config.js` tenga los valores de ejemplo, la app corre en **modo demo** y guarda solo en el navegador. Los valores de `firebaseConfig` no son secretos; la protección la dan las reglas (cada usuario solo lee y escribe `users/{suUid}/…`).

## Datos en Firestore

```
users/{uid}/cards/{id}        nombre, diaCorte, diaPago, deudaInicial, mesInicial, color
users/{uid}/periodos/{cardId}_{YYYY-MM}
                              pagoMes, ajuste, q1, q1Fecha, q2, q2Fecha, pagado, fechaReal, montoPagado
users/{uid}/movs/{id}         tipo (gasto|ingreso), monto, concepto, metodo, cardId, fecha, hora, anotado
users/{uid}/super/{id}        tienda, nombre, cant, comprado
```

## Publicar con GitHub Pages

**Settings → Pages → Deploy from a branch**, rama `main`, carpeta `/ (root)`. Queda en `https://florinusual.github.io/controlgastos/`.

## Instalarla

- **Android (Chrome):** menú ⋮ → **Instalar app**.
- **iPhone/iPad (Safari):** **Compartir** → **Agregar a inicio**.

## Probarla en local

```sh
python3 -m http.server 8000
```

y abre `http://localhost:8000`.
