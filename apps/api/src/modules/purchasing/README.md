# Compras y proveedores

Vacio en esta iteracion. Aqui iran proveedores, tarifas, pedidos y albaranes.

Punto de enganche: `item.purchase_price_cents` es hoy el ultimo precio conocido.
Cuando exista el albaran, ese campo pasara a ser un valor derivado del historico
de compras, y el recalculo en cascada ya montado (`modules/jobs`) se disparara
solo con cada entrada de mercancia.
