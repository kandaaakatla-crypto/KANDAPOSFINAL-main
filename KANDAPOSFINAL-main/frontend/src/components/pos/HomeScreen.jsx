import React from "react";
import { usePos } from "../../store/PosContext";
import OrderScreen from "./OrderScreen";
import RetailSaleScreen from "./RetailSaleScreen";

/** Picks the right "/" screen for this tenant's business type — the full
 *  restaurant order flow (tables/delivery/kitchen) or the lean retail
 *  basket + barcode checkout. */
export default function HomeScreen() {
  const { businessType } = usePos();
  return businessType === "retail" ? <RetailSaleScreen /> : <OrderScreen />;
}
