export type CountWarehouse={id:number;code:string;name:string;active:number;isDefault:number};
export type CountLot={id:number;itemId:number;itemName:string;lotNumber:string;stock:number};
export type CountWarehouseBalance={warehouseId:number;lotId:number;stock:number};
export type CountSheetLine={warehouseId:number;lotId:number;countedQuantity:number};

const EPS=0.000001;

export function bookQuantityForBucket(
  balances:readonly CountWarehouseBalance[],warehouseId:number,lotId:number,
){
  const value=balances.find(row=>row.warehouseId===warehouseId&&row.lotId===lotId)?.stock??0;
  const n=Number(value);
  return Number.isFinite(n)&&Math.abs(n)>EPS?n:0;
}

export function initialCountSheet(
  warehouseId:number,lots:readonly CountLot[],balances:readonly CountWarehouseBalance[],
):CountSheetLine[]{
  if(!Number.isInteger(warehouseId)||warehouseId<=0)return[];
  return lots
    .map(lot=>({warehouseId,lotId:lot.id,countedQuantity:bookQuantityForBucket(balances,warehouseId,lot.id)}))
    .filter(line=>line.countedQuantity>EPS);
}

export function normalizeCountSheet(lines:readonly CountSheetLine[]){
  const seen=new Set<string>();
  return lines.map(line=>{
    const warehouseId=Number(line.warehouseId),lotId=Number(line.lotId),countedQuantity=Number(line.countedQuantity);
    if(!Number.isInteger(warehouseId)||warehouseId<=0)throw new Error("inventory_count_warehouse_required");
    if(!Number.isInteger(lotId)||lotId<=0)throw new Error("inventory_count_lot_required");
    if(!Number.isFinite(countedQuantity)||countedQuantity<0)throw new Error("inventory_count_invalid_quantity");
    const key=`${warehouseId}:${lotId}`;
    if(seen.has(key))throw new Error("inventory_count_duplicate_bucket");
    seen.add(key);
    return{warehouseId,lotId,countedQuantity};
  });
}

export function discrepancy(bookQuantity:number,countedQuantity:number){
  const delta=Number(countedQuantity)-Number(bookQuantity);
  return Math.abs(delta)<EPS?0:delta;
}
