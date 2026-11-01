---
updatedAt: 2026-08-12T19:30:50.000Z
agentTools:
  projectIndex: https://doc.focusnfe.com.br/llms.txt
---

# Consultar

Consulta o status de uma NFe emitida.

Retorna informações sobre o processamento da nota, incluindo status de autorização,
caminhos para download do XML e DANFe, e dados de eventos associados.


# OpenAPI definition

```json
{
  "openapi": "3.0.3",
  "info": {
    "title": "NFe",
    "version": "2.0.0",
    "contact": {
      "name": "Focus NFe Suporte",
      "email": "suporte@focusnfe.com.br"
    },
    "license": {
      "name": "Proprietary",
      "url": "https://focusnfe.com.br"
    }
  },
  "servers": [
    {
      "url": "https://api.focusnfe.com.br/v2",
      "description": "Servidor de Produção"
    },
    {
      "url": "https://homologacao.focusnfe.com.br/v2",
      "description": "Servidor de Homologação"
    }
  ],
  "security": [
    {
      "BasicAuth": []
    }
  ],
  "tags": [
    {
      "name": "NFe",
      "description": "Operações relacionadas a Notas Fiscais Eletrônicas (NFe)"
    }
  ],
  "paths": {
    "/nfe/{referencia}": {
      "get": {
        "tags": [
          "NFe"
        ],
        "summary": "Consultar",
        "description": "Consulta o status de uma NFe emitida.\n\nRetorna informações sobre o processamento da nota, incluindo status de autorização,\ncaminhos para download do XML e DANFe, e dados de eventos associados.\n",
        "operationId": "consultar_nfe",
        "parameters": [
          {
            "name": "referencia",
            "in": "path",
            "required": true,
            "description": "Referência da NFe",
            "schema": {
              "type": "string",
              "example": "12345"
            }
          },
          {
            "name": "completa",
            "in": "query",
            "required": false,
            "description": "Se informado como 1, retorna dados completos da requisição e protocolo",
            "schema": {
              "type": "integer",
              "enum": [
                0,
                1
              ],
              "example": 1
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Requisição processada com sucesso",
            "content": {
              "application/json": {
                "schema": {
                  "oneOf": [
                    {
                      "$ref": "#/components/schemas/NFeProcessandoResponse"
                    },
                    {
                      "$ref": "#/components/schemas/NFeAutorizadaResponse"
                    },
                    {
                      "$ref": "#/components/schemas/CanceladaResponse"
                    },
                    {
                      "$ref": "#/components/schemas/ErroAutorizacaoResponse"
                    }
                  ]
                },
                "examples": {
                  "Processando autorização": {
                    "$ref": "#/components/examples/ProcessandoAutorizacao"
                  },
                  "Autorizada": {
                    "$ref": "#/components/examples/NFeAutorizada"
                  },
                  "Autorizada completa": {
                    "$ref": "#/components/examples/NFeAutorizadaCompleta"
                  },
                  "Cancelada": {
                    "$ref": "#/components/examples/CanceladaResponse"
                  },
                  "Erro autorização": {
                    "$ref": "#/components/examples/ErroAutorizacaoResponse"
                  }
                }
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/AccessDenied"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          }
        }
      }
    }
  },
  "components": {
    "securitySchemes": {
      "BasicAuth": {
        "type": "http",
        "scheme": "basic",
        "description": "Autenticação com usuário e senha (HTTP Basic). O usuário é o token da API e a senha deve ser deixada em branco."
      }
    },
    "responses": {
      "AccessDenied": {
        "description": "Não autorizado",
        "content": {
          "text/html": {
            "schema": {
              "type": "string",
              "example": "HTTP Basic: Access denied"
            }
          }
        }
      },
      "NotFound": {
        "description": "Recurso não encontrado",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/ErrorResponse"
            },
            "example": {
              "codigo": "nao_encontrado",
              "mensagem": "Nota fiscal não encontrada."
            }
          }
        }
      }
    },
    "examples": {
      "NFeAutorizada": {
        "value": {
          "cnpj_emitente": "12345678000123",
          "ref": "referencia_000899_nfe",
          "status": "autorizado",
          "status_sefaz": "100",
          "mensagem_sefaz": "Autorizado o uso da NF-e",
          "chave_nfe": "NFe41190612345678000123550010000000221923094166",
          "numero": "22",
          "serie": "1",
          "caminho_xml_nota_fiscal": "/arquivos/12345678000123/201906/XMLs/41190612345678000123550010000000221923094166-nfe.xml",
          "caminho_danfe": "/arquivos/12345678000123/201906/DANFEs/41190612345678000123550010000000221923094166.pdf"
        }
      },
      "NFeAutorizadaCompleta": {
        "value": {
          "cnpj_emitente": "12345678000123",
          "ref": "nf_ref_ficticia_d3205ae455b84ac2",
          "status": "autorizado",
          "status_sefaz": "100",
          "mensagem_sefaz": "Autorizado o uso da NF-e",
          "chave_nfe": "NFe51260312345678000111558890000015041002168843",
          "numero": "1504",
          "serie": "889",
          "protocolo": "151260029467289",
          "caminho_xml_nota_fiscal": "/arquivos/12345678000123_176610/202603/XMLs/51260312345678000111558890000015041002168843-nfe.xml",
          "caminho_danfe": "/arquivos/12345678000123_176610/202603/DANFEs/51260312345678000111558890000015041002168843.pdf",
          "requisicao_nota_fiscal": {
            "versao": "4.00",
            "chave_nfe": "NFe51260312345678000111558890000015041002168843",
            "uf": "51",
            "codigo_unico": "00216884",
            "natureza_operacao": "Venda de mercadoria",
            "modelo": "55",
            "serie": "889",
            "numero": "1504",
            "data_emissao": "2026-03-30T12:40:37-03:00",
            "tipo_documento": "1",
            "local_destino": "1",
            "municipio": "5106265",
            "formato_impressao": "1",
            "forma_emissao": "1",
            "digito_verificador": "3",
            "ambiente": "1",
            "finalidade_emissao": "1",
            "consumidor_final": "0",
            "presenca_comprador": "0",
            "indicador_intermediario": null,
            "processo_emissao": "0",
            "versao_aplicativo": "0.1.0",
            "notas_referenciadas": [],
            "chaves_nfe_antecipacao_pagamento": [],
            "cnpj_emitente": "12345678000123",
            "nome_emitente": "EMPRESA EXEMPLO AGRONEGOCIO LTDA",
            "nome_fantasia_emitente": "Exemplo Agro Fictício",
            "logradouro_emitente": "CASTANHA",
            "numero_emitente": "SN",
            "bairro_emitente": "GLEBA DIVISA",
            "codigo_municipio_emitente": "5106265",
            "municipio_emitente": "Novo Mundo",
            "uf_emitente": "MT",
            "cep_emitente": "78528000",
            "codigo_pais_emitente": "1058",
            "pais_emitente": "Brasil",
            "telefone_emitente": "1111111111",
            "inscricao_estadual_emitente": "136360173",
            "regime_tributario_emitente": "3",
            "cnpj_destinatario": "99887766000155",
            "nome_destinatario": "DESTINATARIO EXEMPLO AGRO LTDA",
            "logradouro_destinatario": "DIVISA",
            "numero_destinatario": "SN",
            "complemento_destinatario": "LINHA PARANA        KM    2",
            "bairro_destinatario": "ZONA RURAL",
            "codigo_municipio_destinatario": "5106265",
            "municipio_destinatario": "Novo Mundo",
            "uf_destinatario": "MT",
            "cep_destinatario": "78528000",
            "codigo_pais_destinatario": "1058",
            "pais_destinatario": "Brasil",
            "indicador_inscricao_estadual_destinatario": "1",
            "inscricao_estadual_destinatario": "140212370",
            "email_destinatario": "compras@destinatario-exemplo-ficticio.com.br",
            "pessoas_autorizadas": [],
            "itens": [
              {
                "numero_item": "1",
                "codigo_produto": "SOJA INTACTA",
                "codigo_barras_comercial": "SEM GTIN",
                "descricao": "SOJA EM GRAOS (INTACTA)",
                "codigo_ncm": "12019000",
                "nves": [],
                "codigo_beneficio_fiscal": "SEM CBENEF",
                "infos_credito_presumido": [],
                "cfop": "5101",
                "unidade_comercial": "KG",
                "quantidade_comercial": "46720.0000",
                "valor_unitario_comercial": "1.584658",
                "valor_bruto": "74035.23",
                "codigo_barras_tributavel": "SEM GTIN",
                "unidade_tributavel": "KG",
                "quantidade_tributavel": "46720.0000",
                "valor_unitario_tributavel": "1.584658",
                "inclui_no_total": "1",
                "documentos_importacao": [],
                "detalhes_exportacao": [],
                "rastros": [],
                "armamentos": [],
                "origens_combustivel": [],
                "icms_percentual_partilha": "100.0000",
                "ibs_cbs_situacao_tributaria": "200",
                "ibs_cbs_classificacao_tributaria": "200038",
                "ibs_cbs_base_calculo": "74035.23",
                "ibs_uf_aliquota": "0.1000",
                "ibs_uf_percentual_reducao_aliquota": "60.0000",
                "ibs_uf_aliquota_efetiva": "0.0400",
                "ibs_uf_valor": "29.62",
                "ibs_mun_aliquota": "0",
                "ibs_mun_percentual_reducao_aliquota": "60.0000",
                "ibs_mun_aliquota_efetiva": "0",
                "ibs_mun_valor": "0",
                "ibs_valor_total": "29.62",
                "cbs_aliquota": "0.9000",
                "cbs_percentual_reducao_aliquota": "60.0000",
                "cbs_aliquota_efetiva": "0.3600",
                "cbs_valor": "266.53",
                "informacoes_adicionais_item": "Soja intacta.",
                "observacoes_contribuinte": [],
                "icms_origem": "0",
                "icms_situacao_tributaria": "51",
                "icms_reducao_base_calculo": "0",
                "icms_base_calculo": "0",
                "icms_aliquota": "0",
                "icms_valor_operacao": "0",
                "icms_valor_diferido": "0",
                "icms_valor": "0",
                "pis_situacao_tributaria": "09",
                "cofins_situacao_tributaria": "09"
              }
            ],
            "icms_base_calculo": "0",
            "icms_valor_total": "0",
            "icms_valor_total_desonerado": "0",
            "fcp_valor_total": "0",
            "icms_base_calculo_st": "0",
            "icms_valor_total_st": "0",
            "fcp_valor_total_st": "0",
            "fcp_valor_total_retido_st": "0",
            "valor_produtos": "74035.23",
            "valor_frete": "0",
            "valor_seguro": "0",
            "valor_desconto": "0",
            "valor_total_ii": "0",
            "valor_ipi": "0",
            "valor_ipi_devolvido": "0",
            "valor_pis": "0",
            "valor_cofins": "0",
            "valor_outras_despesas": "0",
            "valor_total": "74035.23",
            "ibs_cbs_base_calculo": "74035.23",
            "ibs_uf_valor_total_diferimento": "0",
            "ibs_uf_valor_total_devolucao": "0",
            "ibs_uf_valor_total": "29.62",
            "ibs_mun_valor_total_diferimento": "0",
            "ibs_mun_valor_total_devolucao": "0",
            "ibs_mun_valor_total": "0",
            "ibs_valor_total": "29.62",
            "ibs_valor_total_credito_presumido": "0",
            "ibs_valor_total_condicao_suspensiva": "0",
            "cbs_valor_total_diferimento": "0",
            "cbs_valor_total_devolucao": "0",
            "cbs_valor_total": "266.53",
            "cbs_valor_total_credito_presumido": "0",
            "cbs_valor_total_condicao_suspensiva": "0",
            "ibs_cbs_is_valor_total": null,
            "modalidade_frete": "9",
            "reboques": [],
            "volumes": [],
            "duplicatas": [],
            "formas_pagamento": [
              {
                "forma_pagamento": "90",
                "valor_pagamento": "0",
                "tipo_integracao": null
              }
            ],
            "informacoes_adicionais_contribuinte": "Texto fictício de informações adicionais do contribuinte (ICMS diferido, produtor rural, referências legais de exemplo sem valor jurídico).",
            "observacoes_contribuinte": [],
            "observacoes_fisco": [],
            "processos_referenciados": [],
            "cana_fornecimentos": [],
            "cana_deducoes": [],
            "cnpj_responsavel_tecnico": "07504505000132",
            "contato_responsavel_tecnico": "João Exemplo Fictício",
            "email_responsavel_tecnico": "contato@exemplo-ficticio-doc.com.br",
            "telefone_responsavel_tecnico": "1111111111",
            "agropecuario_defensivo": []
          },
          "protocolo_nota_fiscal": {
            "versao": "4.00",
            "ambiente": "1",
            "versao_aplicativo": "MT_A2_SRV240225-4.00",
            "chave_nfe": "51260312345678000111558890000015041002168843",
            "data_recebimento": "2026-03-30T11:40:40-04:00",
            "numero_protocolo": "151260029467289",
            "digest_value": "XtMpTWKzD/M9geerCPwAOZ5YRU8=",
            "status": "100",
            "motivo": "Autorizado o uso da NF-e"
          }
        }
      },
      "ProcessandoAutorizacao": {
        "value": {
          "cnpj_emitente": "12345678000123",
          "ref": "referencia_000899_nfe",
          "status": "processando_autorizacao"
        }
      },
      "CanceladaResponse": {
        "value": {
          "cnpj_emitente": "12345678000123",
          "ref": "referencia_000899_nfe",
          "status": "cancelado",
          "status_sefaz": "135",
          "mensagem_sefaz": "Evento registrado e vinculado a NF-e",
          "chave_nfe": "NFe41190612345678000123550010000000221923094166",
          "numero": "22",
          "serie": "1",
          "caminho_xml_nota_fiscal": "/arquivos/12345678000123/201906/XMLs/41190612345678000123550010000000221923094166-nfe.xml",
          "caminho_danfe": "/arquivos/12345678000123/201906/DANFEs/41190612345678000123550010000000221923094166.pdf",
          "caminho_xml_cancelamento": "/arquivos/12345678000123/201906/XMLs/41190612345678000123550010000000221923094166-can.xml"
        }
      },
      "ErroAutorizacaoResponse": {
        "value": {
          "cnpj_emitente": "12345678000123",
          "ref": "referencia_000899_nfe",
          "status": "erro_autorizacao",
          "status_sefaz": "598",
          "mensagem_sefaz": "Rejeição: Total da NF difere do somatório dos valores que compõe o valor total da NF",
          "erros": [
            {
              "codigo": "",
              "mensagem": "Total da NF difere do somatório dos valores que compõe o valor total da NF"
            }
          ]
        }
      }
    },
    "schemas": {
      "ErrorResponse": {
        "title": "Erro",
        "type": "object",
        "properties": {
          "codigo": {
            "type": "string",
            "description": "Código do erro."
          },
          "mensagem": {
            "type": "string",
            "description": "Mensagem do erro."
          },
          "erros": {
            "type": "array",
            "description": "Lista de erros.",
            "items": {
              "type": "object",
              "properties": {
                "mensagem": {
                  "type": "string",
                  "description": "Mensagem do erro."
                },
                "campo": {
                  "type": "string",
                  "description": "Nome do campo que causou o erro."
                }
              }
            }
          }
        }
      },
      "NFeAutorizadaResponse": {
        "title": "Resposta NFe Autorizada",
        "type": "object",
        "properties": {
          "cnpj_emitente": {
            "type": "string",
            "description": "CNPJ do emitente"
          },
          "ref": {
            "type": "string",
            "description": "Referência da emissão"
          },
          "status": {
            "type": "string",
            "description": "Status da NFe",
            "enum": [
              "autorizado"
            ]
          },
          "status_sefaz": {
            "type": "string",
            "description": "Status na SEFAZ"
          },
          "mensagem_sefaz": {
            "type": "string",
            "description": "Mensagem descritiva da SEFAZ"
          },
          "chave_nfe": {
            "type": "string",
            "description": "Chave da NFe"
          },
          "numero": {
            "type": "string",
            "description": "Número da nota fiscal"
          },
          "serie": {
            "type": "string",
            "description": "Série da nota fiscal"
          },
          "caminho_xml_nota_fiscal": {
            "type": "string",
            "description": "Caminho para download do XML"
          },
          "caminho_danfe": {
            "type": "string",
            "description": "Caminho para download do DANFe"
          },
          "caminho_danfe_etiqueta": {
            "type": "string",
            "description": "Caminho para download do DANFe Etiqueta"
          }
        }
      },
      "CanceladaResponse": {
        "title": "NFe cancelada",
        "type": "object",
        "properties": {
          "cnpj_emitente": {
            "type": "string",
            "description": "CNPJ do emitente"
          },
          "ref": {
            "type": "string",
            "description": "Referência da emissão"
          },
          "status": {
            "type": "string",
            "description": "Status da NFe",
            "enum": [
              "cancelado"
            ]
          },
          "status_sefaz": {
            "type": "string",
            "description": "Status na SEFAZ"
          },
          "mensagem_sefaz": {
            "type": "string",
            "description": "Mensagem descritiva da SEFAZ"
          },
          "chave_nfe": {
            "type": "string",
            "description": "Chave da NFe"
          },
          "numero": {
            "type": "string",
            "description": "Número da nota fiscal"
          },
          "serie": {
            "type": "string",
            "description": "Série da nota fiscal"
          },
          "caminho_xml_nota_fiscal": {
            "type": "string",
            "description": "Caminho para download do XML"
          },
          "caminho_danfe": {
            "type": "string",
            "description": "Caminho para download do DANFe"
          },
          "caminho_xml_cancelamento": {
            "type": "string",
            "description": "Caminho para download do XML de cancelamento"
          }
        }
      },
      "ErroAutorizacaoResponse": {
        "title": "Erro autorização",
        "type": "object",
        "properties": {
          "cnpj_emitente": {
            "type": "string",
            "description": "CNPJ do emitente"
          },
          "ref": {
            "type": "string",
            "description": "Referência da emissão"
          },
          "status": {
            "type": "string",
            "description": "Status da NFe",
            "enum": [
              "erro_autorizacao"
            ]
          },
          "status_sefaz": {
            "type": "string",
            "description": "Status na SEFAZ"
          },
          "mensagem_sefaz": {
            "type": "string",
            "description": "Mensagem descritiva da SEFAZ"
          },
          "erros": {
            "type": "array",
            "description": "Lista de erros de validação ou rejeição",
            "items": {
              "$ref": "#/components/schemas/ErrorResponse"
            }
          }
        }
      },
      "NFeProcessandoResponse": {
        "title": "Resposta NFe Processando",
        "type": "object",
        "properties": {
          "cnpj_emitente": {
            "type": "string",
            "description": "CNPJ do emitente",
            "example": "12345678000123"
          },
          "ref": {
            "type": "string",
            "description": "Referência da emissão",
            "example": "referencia_000899_nfe"
          },
          "status": {
            "type": "string",
            "description": "Status da NFe",
            "enum": [
              "processando_autorizacao"
            ],
            "example": "processando_autorizacao"
          }
        }
      }
    }
  }
}
```