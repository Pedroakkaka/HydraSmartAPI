/*
 * HYDRASMART — DIAGNÓSTICO DAS RÉGUAS DE ELETRODOS (Arduino Uno)
 *
 * Use este programa só para testar a montagem. Ele mostra, a cada 2 segundos,
 * o que cada contato da régua está "enxergando", para descobrir por que o nível
 * não está sendo lido.
 *
 * COMO USAR
 *  1. Grave este programa no Arduino (Arduino IDE → Carregar).
 *  2. Abra Ferramentas → Monitor Serial, velocidade 115200.
 *  3. Deixe a régua SECA e anote os valores. Depois mergulhe a régua até a metade
 *     e anote de novo. Mande os dois prints para quem está ajustando o sistema.
 *  4. Depois do teste, grave de novo o firmware normal da régua.
 *
 * LIGAÇÃO ESPERADA (igual ao firmware das réguas)
 *  - Bueiro 01: A0 A1 A2 A3 A4 A5 (do contato mais baixo para o mais alto)
 *  - Bueiro 02: D2 D3 D4 D5 D6 D7 (do contato mais baixo para o mais alto)
 *  - Um fio de REFERÊNCIA em cada compartimento, ligado ao GND do Arduino,
 *    chegando ao fundo (abaixo do contato mais baixo).
 *
 * COMO LER O RESULTADO
 *  - Bueiro 01 mostra o valor analógico (0 a 1023):
 *      perto de 1023 = seco | valor que cai quando molha = o contato está funcionando
 *      o firmware atual só entende "molhado" abaixo de ~300.
 *  - Bueiro 02 mostra só SECO/MOLHADO (pinos digitais não medem valor).
 *  - Teste de GND: encoste a ponta do fio de referência direto em cada contato.
 *    Se mesmo assim não marcar MOLHADO, o problema é fio/ligação, não a água.
 */

const byte PINOS_B1[6] = {A0, A1, A2, A3, A4, A5};
const byte PINOS_B2[6] = {2, 3, 4, 5, 6, 7};
const int LIMIAR_DIGITAL_APROX = 300; // abaixo disso o pino digital lê LOW (molhado)

void setup() {
  Serial.begin(115200);
  for (byte i = 0; i < 6; i++) {
    pinMode(PINOS_B1[i], INPUT);
    pinMode(PINOS_B2[i], INPUT);
  }
  Serial.println(F("=== HYDRASMART: diagnostico das reguas de eletrodos ==="));
  Serial.println(F("Seco ~1023. Se o valor cai ao molhar mas nao passa de ~300, o firmware atual nao detecta."));
}

// Liga o resistor interno só durante a medida (reduz a corrosão dos eletrodos).
int lerAnalogico(byte pino) {
  pinMode(pino, INPUT_PULLUP);
  delay(5);
  long soma = 0;
  for (byte i = 0; i < 8; i++) soma += analogRead(pino);
  pinMode(pino, INPUT);
  return (int)(soma / 8);
}

bool lerDigitalMolhado(byte pino) {
  pinMode(pino, INPUT_PULLUP);
  delay(5);
  byte baixos = 0;
  for (byte i = 0; i < 8; i++) if (digitalRead(pino) == LOW) baixos++;
  pinMode(pino, INPUT);
  return baixos >= 6;
}

void loop() {
  Serial.println();
  Serial.println(F("Contato:      1(baixo)  2      3      4      5      6(alto)"));

  Serial.print(F("Bueiro 01:    "));
  int menor = 1023;
  for (byte i = 0; i < 6; i++) {
    int v = lerAnalogico(PINOS_B1[i]);
    if (v < menor) menor = v;
    Serial.print(v);
    Serial.print(v < LIMIAR_DIGITAL_APROX ? F("*") : F(" "));
    Serial.print(F("   "));
  }
  Serial.println();

  Serial.print(F("Bueiro 02:    "));
  for (byte i = 0; i < 6; i++) {
    Serial.print(lerDigitalMolhado(PINOS_B2[i]) ? F("MOLHADO ") : F("seco    "));
  }
  Serial.println();

  if (menor > 1000) {
    Serial.println(F("-> B01: nenhum contato percebe agua. Verifique o fio de referencia (GND) e se a ponta metalica do jumper esta exposta."));
  } else if (menor >= LIMIAR_DIGITAL_APROX) {
    Serial.print(F("-> B01: a agua E percebida (menor valor "));
    Serial.print(menor);
    Serial.println(F("), mas fraca demais para o firmware atual. Solucao: limiar analogico ajustavel."));
  } else {
    Serial.println(F("-> B01: leitura forte o suficiente (* = molhado)."));
  }
  delay(2000);
}
