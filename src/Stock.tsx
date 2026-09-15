import { Plus, Package } from "lucide-react";
import { fmt, type Pet } from "./domain";
import { Card, Empty } from "./components";
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
      <div className="heading">
        <span className="eyebrow">Всё под рукой</span>
        <h1>Питание и запасы</h1>
        <p>Остаток корма и список покупок</p>
      </div>
      <Card>
        <span className="eyebrow">Корм · фактический остаток</span>
        <div className="section-title">
          <div className="large">
            {pet.stock.toLocaleString("ru-RU")} <small>кг</small>
          </div>
          <span className="pill">
            <Package size={16} />
            {days === null ? "Укажите расход" : `≈ ${days} дн.`}
          </span>
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
        <button className="primary" onClick={onAdd}>
          <Plus size={18} />
          Пополнить
        </button>
        <button className="text-button" onClick={onEdit}>
          Изменить расход или остаток
        </button>
      </Card>
      {days !== null && days <= 7 && (
        <p className="notice">
          По указанному остатку корма хватит примерно на {days} дн.
        </p>
      )}
      <div className="section-title">
        <h2>Купить</h2>
        <span className="hint">
          {pet.shopping.filter((s) => !s.done).length} в списке
        </span>
      </div>
      {pet.shopping.length ? (
        pet.shopping.map((s) => (
          <label className={`shopping ${s.done ? "done" : ""}`} key={s.id}>
            <input
              type="checkbox"
              checked={s.done}
              onChange={() => onToggle(s.id)}
            />
            <span>
              {s.name}
              <small>{s.quantity}</small>
            </span>
          </label>
        ))
      ) : (
        <Empty title="Всё есть дома">
          Добавляйте покупки по мере необходимости.
        </Empty>
      )}
      <button className="secondary" onClick={onShop}>
        <Plus size={17} />
        Добавить покупку
      </button>
      <p className="hint">
        Отметка покупки не меняет запас. Купленный корм добавляйте кнопкой
        «Пополнить».
      </p>
    </>
  );
}
