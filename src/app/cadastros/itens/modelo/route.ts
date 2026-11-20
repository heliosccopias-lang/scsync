import { TEMPLATE_CSV } from "@/lib/catalog-import";

export function GET() {
  return new Response(TEMPLATE_CSV, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="modelo-servicos-produtos.csv"',
    },
  });
}
