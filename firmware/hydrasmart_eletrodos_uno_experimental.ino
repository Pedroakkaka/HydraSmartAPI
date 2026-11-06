/*
 HYDRASMART — Firmware EXPERIMENTAL para régua de eletrodos (Arduino Uno)
 - 6 entradas de nível: A0, A1, A2, A3, A4, A5
 - 1 referência comum na água: GND
 - 1 bomba existente: NÃO é controlada neste firmware.
 ATENÇÃO: presume A0 = contato mais baixo e A5 = mais alto.
 Verifique a ordem real, isolamento elétrico e use APENAS baixa tensão da placa.
 Não conecte bomba diretamente aos pinos do Arduino.
 Entrada INPUT_PULLUP usa corrente pequena, mas contato contínuo com água
 pode provocar corrosão; para implantação duradoura utilize condicionamento
 e eletrodos próprios. Faça testes sem bomba energizada.
*/
const byte contatos[6] = { A0, A1, A2, A3, A4, A5 };
const unsigned long intervaloMs = 1000;
unsigned long ultimaMedicao = 0;

void setup() {
  Serial.begin(115200);
  for (byte i = 0; i < 6; i++) pinMode(contatos[i], INPUT);
  Serial.println("{\"status\":\"HYDRASMART_ELETRODOS_6_NIVEIS_READY\"}");
}

void loop() {
  if (millis() - ultimaMedicao < intervaloMs) return;
  ultimaMedicao = millis();

  // Habilitar pull-up somente durante janela curta de amostragem.
  // A referência GND deve estar em contato com a mesma água.
  byte amostras[6] = {0,0,0,0,0,0};
  for (byte n = 0; n < 5; n++) {
    for (byte i = 0; i < 6; i++) pinMode(contatos[i], INPUT_PULLUP);
    delay(4);
    for (byte i = 0; i < 6; i++) {
      if (digitalRead(contatos[i]) == LOW) amostras[i]++;
      pinMode(contatos[i], INPUT);
    }
    delay(4);
  }
  byte mascara = 0;
  for (byte i = 0; i < 6; i++) {
    if (amostras[i] >= 4) mascara |= (1 << i);
  }
  // Falhas de continuidade geram estado inválido, não percentual inventado.
  byte niveis = 0;
  bool lacuna = false;
  for (byte i = 0; i < 6; i++) {
    if (mascara & (1 << i)) {
      if (lacuna) {
        Serial.println("{\"bueiro\":1,\"erro\":\"CONTATOS_INCONSISTENTES\"}");
        return;
      }
      niveis++;
    } else lacuna = true;
  }
  // Se espaçamentos não forem iguais, percentual requer calibração por altura.
  float percentual = (niveis * 100.0f) / 6.0f;
  Serial.print("{\"bueiro\":1,\"nivel_pct\":");
  Serial.print(percentual, 1);
  Serial.print(",\"raw\":");
  Serial.print(mascara);
  Serial.println("}");
}
