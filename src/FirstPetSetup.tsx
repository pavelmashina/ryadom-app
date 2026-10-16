import { Button, Card, Field, Form, PageHeader, Select, text } from "./components";
import { today } from "./domain";
import type { PetBasics } from "./first-pet-setup";
import { useState } from "react";

export default function FirstPetSetup({
  onSave,
  onSkip,
}: {
  onSave: (details: PetBasics) => Promise<void>;
  onSkip: () => Promise<void>;
}) {
  const [skipping, setSkipping] = useState(false);
  const [skipError, setSkipError] = useState("");
  return (
    <div className="first-pet-setup">
      <PageHeader title="Давайте познакомимся" eyebrow="Первый шаг">
        Добавьте питомца — и мы подготовим для него календарь, дневник занятий и историю здоровья.
      </PageHeader>
      <Card>
        <Form label="Начать заботиться" onSave={async (data) => {
          await onSave({
            name: text(data, "name"),
            breed: text(data, "breed"),
            birthday: text(data, "birthday"),
            sex: text(data, "sex") as PetBasics["sex"],
            chip: text(data, "chip"),
          });
        }}>
          <Field label="Имя питомца" name="name" placeholder="Например, Бублик"
            required maxLength={80} autoComplete="off" />
          <Field label="Порода · необязательно" name="breed" maxLength={120} />
          <Field label="Дата рождения · необязательно" name="birthday"
            type="date" max={today()} />
          <Select label="Пол · необязательно" name="sex" defaultValue="">
            <option value="">Не указан</option>
            <option value="Девочка">Девочка</option>
            <option value="Мальчик">Мальчик</option>
          </Select>
          <Field label="Номер чипа · необязательно" name="chip" maxLength={100} />
          <p className="hint">Все сведения, кроме имени, можно добавить позже в профиле.</p>
        </Form>
      </Card>
      {skipError && <p role="alert" className="notice notice-error">{skipError}</p>}
      <Button variant="ghost" fullWidth loading={skipping}
        onClick={async () => {
          setSkipping(true);
          setSkipError("");
          try {
            await onSkip();
          } catch (error) {
            setSkipError(error instanceof Error ? error.message : "Не удалось сохранить пропуск");
          } finally {
            setSkipping(false);
          }
        }}>
        Заполнить позже
      </Button>
    </div>
  );
}
