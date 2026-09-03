# Gridwright

## Qué es

Una herramienta de maquetación completa. Lo dijo Luciano el 2026-09-03 al crear
el repo, y **eso es todo lo que está definido**.

## Lo que NO está decidido

No inventes ninguna de estas. Preguntá antes de escribir código:

- **Qué maqueta**: ¿web (HTML/CSS)? ¿impresión / editorial? ¿ambas?
- **Quién la usa**: ¿él solo? ¿diseñadores? ¿desarrolladores?
- **Qué forma tiene**: ¿app de escritorio? ¿web? ¿CLI? ¿librería? ¿extensión?
- **El stack**: nada elegido.
- **Qué significa "completa"**: es la palabra que usó, y define el alcance.

El nombre —grid + wright, el que fabrica— sugiere algo de grillas, pero **es una
inferencia mía, no algo que él haya dicho**. No la tomes como dato.

## Cómo trabaja Luciano

Esto sí está establecido, sale de trabajar con él en el portfolio, en `autofill`
y en los productos de Dmeter.

**Spec antes que código.** Spec-driven development, y no como eslogan: en el
portfolio hay un `specs/001-interaction-language.md` con cuatro leyes que
gobiernan cada interacción del sitio, escritas antes de implementar. Para algo
de este tamaño, el primer entregable es una spec, no un scaffold.

**Las reglas de negocio son dato, no código.** Patrón que repite en todos sus
productos: la tabla de esfuerzo por actividad, los límites por franja etaria, el
esquema de cada rubro. Si algo cambia sin tocar el algoritmo, va como dato.

**Comentarios en español, y explican el porqué.** No lo que hace la línea —eso
se lee— sino la razón por la que está así. Los buenos comentarios de sus repos
cuentan qué se rompió antes.

**Tests que valen.** No cobertura por cobertura: tests contra la cosa real.
Hornero tiene 248 contra un Postgres de verdad. `autofill` tiene 127, varios
calcados de formularios reales que rompieron.

**Sin margins entre hermanos.** Flex o grid con `gap`. Es regla dura en sus
proyectos de UI.

**Nada se envía ni se publica solo.** Principio de diseño transversal en Dmeter:
*el sistema genera, la persona decide*.

## Git

- Cuenta personal: **BalbianoLuciano** (`balbiano06@gmail.com`).
  Si `gh` tiene activa la cuenta de trabajo, cambiar con
  `gh auth switch -u BalbianoLuciano`.
- El push por SSH falla en esta máquina para esa cuenta; anda por HTTPS con el
  token de `gh`.
- Mensajes de commit en español, en minúscula, explicando el porqué del cambio.

## Quién es

Luciano Balbiano — AI Engineer. Co-fundador y Frontend Architect en Dmeter
(seis productos en producción), Team Leader en Invisible Geeks.
TypeScript, Laravel, Vue, React, Postgres. Viene de Arquitectura y Urbanismo,
que es de donde le sale el ojo para interfaces.
