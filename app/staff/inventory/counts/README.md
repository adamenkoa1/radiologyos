# Inventory count workspace

UI follow-up to the inventory count registrar added in #386.

The client submits only warehouse/lot identity, the observed counted quantity, and an optional reason. The canonical book quantity is captured by the server when the draft is created and is revalidated by D1 when the document is posted.

No schema or production-deploy changes are part of this UI follow-up.
