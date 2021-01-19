<template>
  <v-container>
    <v-card flat>
      <v-card-title class="text-h3"> Safe in Sisters </v-card-title>
      <v-card-subtitle class="text-h5">An Oregon Initiative</v-card-subtitle>
      <!-- <span class="text-h6">Bottom Lihe Up Front</span> -->

      <v-card-text class="text-body-2">
        Local Contact Tracing can help communities like
        <a href="https://www.ci.sisters.or.us" target="_blank"
          >Sisters, Oregon</a
        ><strong> reopen their economies without reopening the pandemic</strong
        >. That is, LCT lets us balance the
        <strong>risk of infection</strong> with
        <strong>the risk of bankruptcy</strong>.
      </v-card-text>
    </v-card>
    <!-- <v-row align="center"> -->
    <v-card>
      <v-tabs v-model="tab" center-active background-color="purple" dark>
        <v-tab v-for="item in items" :key="item.tab">
          {{ item.tab }}
        </v-tab>
      </v-tabs>

      <v-tabs-items v-model="tab">
        <v-tab-item v-for="item in items" :key="item.tab">
          <v-card flat>
            <v-card-text v-html="item.content"> </v-card-text>

            <v-row v-if="!item.content" align="center">
              <v-item-group
                v-model="window"
                class="shrink mr-6"
                mandatory
                tag="v-flex"
              >
                <v-item
                  v-for="n in length"
                  :key="n"
                  v-slot:default="{ active, toggle }"
                >
                  <div>
                    <v-btn
                      class="mx-3"
                      :input-value="active"
                      icon
                      @click="toggle"
                    >
                      <v-icon>mdi-record</v-icon>
                    </v-btn>
                  </div>
                </v-item>
              </v-item-group>

              <v-col>
                <v-window v-model="window" class="elevation-1 ml-0" vertical>
                  <v-window-item v-for="n in length" :key="n">
                    <v-card flat class="ml-3">
                      <v-card-text>
                        <v-row class="mb-4" align="center">
                          <v-avatar color="grey" class="mr-4 white--text">{{
                            n
                          }}</v-avatar>
                          <strong class="title"> {{ getText(n, 'h') }}</strong>
                          <v-spacer></v-spacer>
                          <v-btn icon>
                            <v-icon>mdi-account</v-icon>
                          </v-btn>
                        </v-row>
                        <span v-html="getText(n, 't')"></span>
                      </v-card-text>
                    </v-card>
                  </v-window-item>
                </v-window>
              </v-col>
            </v-row>
          </v-card>
        </v-tab-item>
      </v-tabs-items>
    </v-card>
  </v-container>
</template>
