# Inventario

Vacio en esta iteracion. Aqui iran existencias por almacen, recuentos, ajustes
y valoracion de stock.

Puntos de enganche ya listos:

- `warehouse` en el esquema, con su tipo (camara, congelador, seco, barra).
- La unidad de stock de cada item y el factor `purchaseToStock`, que es lo que
  convierte un albaran en existencias.
- `packages/domain` resuelve la conversion entre unidad de compra, de stock y
  de uso: la valoracion no tendra que reimplementarla.
