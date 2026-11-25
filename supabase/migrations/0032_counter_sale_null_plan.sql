-- 0032: a cash/Pix/card sale paid on the spot sends "plan": null; jsonb null is not SQL NULL, so the
-- function took it for an installment plan and refused it ("plan_not_paid_now"). Treat a JSON null as no plan.
do $m$
declare def text;
begin
  def := pg_get_functiondef('create_counter_sale(uuid,jsonb)'::regprocedure);
  def := replace(def, $x$v_plan jsonb := p->'plan';$x$, $x$v_plan jsonb := nullif(p->'plan', 'null'::jsonb);$x$);
  execute def;
end $m$;
