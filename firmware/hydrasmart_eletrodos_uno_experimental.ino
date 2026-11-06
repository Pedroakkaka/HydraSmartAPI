/*
 HYDRASMART — duas réguas de contatos de água, Arduino Uno R3.
 B01: A0 A1 A2 A3 A4 A5 (do contato inferior ao superior).
 B02: D2 D3 D4 D5 D6 D7 (do contato inferior ao superior).
 Cada reservatório possui seu próprio eletrodo de referência GND;
 os dois eletrodos de referência compartilham o GND do Arduino.
 Uma amostra por segundo para cada régua, 115200 baud.
 Não aciona bomba. Não usar D2–D7 se já estiverem ocupados.
 ATENÇÃO: circuito experimental com INPUT_PULLUP e leitura LOW quando molhado.
 Testar inicialmente com bomba desligada. A condutividade da água varia;
 para uso prolongado aplicar proteção/condicionamento e eletrodos adequados.
 Nunca ligar bomba ou tensão da rede diretamente aos pinos do Arduino.
 Percentuais só representam frações iguais da altura se contatos equidistantes.
*/
const byte TOTAL_BUEIROS = 2;
const byte TOTAL_NIVEIS = 6;
const byte PINOS[TOTAL_BUEIROS][TOTAL_NIVEIS] = {
  {A0, A1, A2, A3, A4, A5},
  {2, 3, 4, 5, 6, 7}
};
const unsigned long BAUD = 115200;
const unsigned long INTERVALO_MS = 1000;
unsigned long ultimaMedicao = 0;

void setup() {
  Serial.begin(BAUD);
  for (byte b = 0; b < TOTAL_BUEIROS; b++) {
    for (byte i = 0; i < TOTAL_NIVEIS; i++) {
      pinMode(PINOS[b][i], INPUT);
      digitalWrite(PINOS[b][i], LOW); // pull-up desativado
    }
  }
  Serial.println(F("{\"status\":\"HYDRASMART_DUAS_REGUAS_READY\",\"bueiros\":2}"));
}

void lerBueiro(byte indice) {
  byte contagens[TOTAL_NIVEIS] = {0, 0, 0, 0, 0, 0};
  // Energiza os eletrodos somente durante a pequena janela de leitura.
  for (byte amostra = 0; amostra < 5; amostra++) {
    for (byte i = 0; i < TOTAL_NIVEIS; i++)
      pinMode(PINOS[indice][i], INPUT_PULLUP);
    delay(4);
    for (byte i = 0; i < TOTAL_NIVEIS; i++) {
      if (digitalRead(PINOS[indice][i]) == LOW) contagens[i]++;
      pinMode(PINOS[indice][i], INPUT);
      digitalWrite(PINOS[indice][i], LOW);
    }
    delay(4);
  }

  byte mascara = 0;
  for (byte i = 0; i < TOTAL_NIVEIS; i++) {
    if (contagens[i] >= 4) mascara |= (byte)(1U << i);
  }
  byte niveis = 0;
  bool lacuna = false;
  for (byte i = 0; i < TOTAL_NIVEIS; i++) {
    if (mascara & (1U << i)) {
      if (lacuna) {
        Serial.print(F("{\"bueiro\":"));
        Serial.print(indice + 1);
        Serial.println(F(",\"erro\":\"CONTATOS_INCONSISTENTES\"}"));
        return;
      }
      niveis++;
    } else {
      lacuna = true;
    }
  }
  const float nivelPct = 100.0f * niveis / TOTAL_NIVEIS;
  Serial.print(F("{\"bueiro\":"));
  Serial.print(indice + 1);
  Serial.print(F(",\"nivel_pct\":"));
  Serial.print(nivelPct, 1);
  Serial.print(F(",\"contatos_ativos\":"));
  Serial.print(niveis);
  Serial.print(F(",\"raw\":"));
  Serial.print(mascara);
  Serial.println('}');
}

void loop() {
  const unsigned long agora = millis();
  if (agora - ultimaMedicao < INTERVALO_MS) return;
  ultimaMedicao = agora;
  lerBueiro(0);
  lerBueiro(1);
}
