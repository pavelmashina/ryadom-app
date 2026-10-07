import { SectionHeader, PageHeader, Button, Card, Empty, Checkbox, Badge } from "./components";
import { Plus, Package } from "lucide-react";
import { fmt, type Pet } from "./domain";
export default function Stock({
  pet,
  onEdit,
  onAdd,
  onShop,
  onToggle,
}: {
  pet: Pet;
  onEdit: () => void;
  onAdd: () => void;
  onShop: () => void;
  onToggle: (id: string) => void;
}) {
  const days =
    pet.ration > 0 ? Math.floor((pet.stock * 1000) / pet.ration) : null;
  return (
    <>
      <PageHeader title="Питание и запасы" eyebrow="Всё под рукой">
        Остаток корма и список покупок
      </PageHeader>
      <Card variant="info">
        <span className="eyebrow">Корм · фактический остаток</span>
        <div className="section-title">
          <div className="large">
            {pet.stock.toLocaleString("ru-RU")} <small>кг</small>
          </div>
          <Badge>
            <Package />
            {days === null ? "Укажите расход" : `≈ ${days} дн.`}
          </Badge>
        </div>
        <progress
          value={Math.min(pet.stock, pet.pack)}
          max={pet.pack}
          aria-label={`Остаток ${pet.stock} кг, размер упаковки ${pet.pack} кг`}
        />
        <div className="spread hint">
          <span>0 кг</span>
          <span>{pet.pack} кг · упаковка</span>
        </div>
        <p className="hint">
          {pet.ration
            ? `Прогноз от указанного остатка по вашему расходу ${pet.ration} г/день.`
            : "Укажите свой суточный расход для прогноза."}{" "}
          Это не рекомендация по питанию.
        </p>
        <p className="hint">
          {pet.stockDate ? `Остаток обновлён ${fmt(pet.stockDate)}. ` : ""}
          Расход автоматически не списывается — обновляйте остаток после
          проверки.
        </p>
        <Button onClick={onAdd} fullWidth variant="primary">
          <Plus />
          Пополнить
        </Button>
        <Button onClick={onEdit} variant="ghost">
          Изменить расход или остаток
        </Button>
      </Card>
      {days !== null && days <= 7 && (
        <p className="notice">
          По указанному остатку корма хватит примерно на {days} дн.
        </p>
      )}
      <SectionHeader title="Купить">
        <span className="hint">
          {pet.shopping.filter((s) => !s.done).length} в списке
        </span>
      </SectionHeader>
      {pet.shopping.length ? (
        pet.shopping.map((s) => (
          <Checkbox
            className={`shopping ${s.done ? "done" : ""}`}
            key={s.id}
            checked={s.done}
            onChange={() => onToggle(s.id)}
            label={
              <span>
                {s.name}
                <small>{s.quantity}</small>
              </span>
            }
          />
        ))
      ) : (
        <Empty title="Всё есть дома">
          Добавляйте покупки по мере необходимости.
        </Empty>
      )}
      <Button onClick={onShop} fullWidth variant="secondary">
        <Plus />
        Добавить покупку
      </Button>
      <p className="hint">
        Отметка покупки не меняет запас. Купленный корм добавляйте кнопкой
        «Пополнить».
      </p>
    </>
  );
}
